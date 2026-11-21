"""Live wallpapers uploaded by administrators.

An admin uploads a video from the Appearance panel and picks the part of it that loops (start/end
seconds) and two accent colours. Every account can then choose it as a glass theme; students can
pick one but never upload. The video is streamed straight into MongoDB GridFS (no size limit of a
normal document, kept in the database volume), and served back with HTTP Range support so the
browser can seek to the loop start and jump back at the loop end.

  GET    /api/wallpapers                    list (public: the sign-in page shows them too)
  GET    /api/wallpapers/{id}/video         the video, Range requests supported
  GET    /api/wallpapers/{id}/poster        a JPEG of the first loop frame (made by the browser)
  POST   /api/admin/wallpapers?name=…       upload: the request body is the raw video file
  PATCH  /api/admin/wallpapers/{id}         name, loop start/end, colours, poster
  DELETE /api/admin/wallpapers/{id}
"""
import base64
import re
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response, StreamingResponse
from gridfs.errors import NoFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field

from app.core.db import db
from app.domain.exceptions import InvalidInputError, ResourceNotFoundError
from app.routers.admin import admin

router = APIRouter(tags=['wallpapers'])

MAX_BYTES = 300 * 1024 * 1024           # 300 MB
MAX_POSTER_BYTES = 600 * 1024
MAX_WALLPAPERS = 24
VIDEO_TYPES = {'video/mp4', 'video/webm', 'video/quicktime'}
HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
CHUNK = 512 * 1024

_bucket: Optional[AsyncIOMotorGridFSBucket] = None


def files() -> AsyncIOMotorGridFSBucket:
    global _bucket
    if _bucket is None:
        _bucket = AsyncIOMotorGridFSBucket(db, bucket_name='wallpaper_files')
    return _bucket


def _now():
    return datetime.now(timezone.utc)


def _oid(wid: str) -> ObjectId:
    try:
        return ObjectId(wid)
    except (InvalidId, TypeError):
        raise ResourceNotFoundError('That wallpaper does not exist.')


async def _get(wid: str) -> dict:
    doc = await db.wallpapers.find_one({'_id': _oid(wid)})
    if not doc:
        raise ResourceNotFoundError('That wallpaper does not exist (an administrator may have removed it).')
    return doc


def public(d: dict) -> dict:
    updated = d.get('updated_at') or d.get('created_at')
    return {
        'id': str(d['_id']), 'name': d.get('name') or 'Wallpaper',
        'start': d.get('start', 0.0), 'end': d.get('end'), 'duration': d.get('duration'),
        'a': d.get('a') or '#8B7CFF', 'b': d.get('b') or '#3EE6D0',
        'content_type': d.get('content_type', 'video/mp4'), 'size': d.get('size', 0),
        'has_poster': bool(d.get('has_poster') or d.get('poster')), 'uploaded_by_name': d.get('uploaded_by_name'),
        'created_at': d['created_at'].isoformat() if d.get('created_at') else None,
        'version': int(updated.timestamp()) if updated else 0,
    }


# ───────────── for everyone ─────────────
@router.get('/wallpapers')
async def list_wallpapers():
    docs = await db.wallpapers.find({}, {'poster': 0}).sort('created_at', 1).to_list(MAX_WALLPAPERS)
    return [public(d) for d in docs]


@router.get('/wallpapers/{wid}/poster')
async def poster(wid: str):
    doc = await _get(wid)
    if not doc.get('poster'):
        raise ResourceNotFoundError('This wallpaper has no preview image yet.')
    return Response(bytes(doc['poster']), media_type='image/jpeg', headers={'Cache-Control': 'public, max-age=86400'})


@router.get('/wallpapers/{wid}/video')
async def video(wid: str, request: Request):
    doc = await _get(wid)
    try:
        out = await files().open_download_stream(doc['file_id'])
    except NoFile:
        raise ResourceNotFoundError('The video file of this wallpaper is missing.')
    size = out.length
    start, end, status = 0, size - 1, 200
    m = re.fullmatch(r'bytes=(\d*)-(\d*)', (request.headers.get('range') or '').strip())
    if m and (m.group(1) or m.group(2)):
        first, last = m.groups()
        if first == '':                      # "bytes=-500": the last 500 bytes
            start = max(0, size - int(last))
        else:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        if start >= size or start > end:
            return Response(status_code=416, headers={'Content-Range': f'bytes */{size}'})
        status = 206
    out.seek(start)

    async def body():
        left = end - start + 1
        while left > 0:
            chunk = await out.read(min(left, CHUNK))
            if not chunk:
                break
            left -= len(chunk)
            yield chunk

    headers = {'Accept-Ranges': 'bytes', 'Content-Length': str(end - start + 1),
               'Cache-Control': 'public, max-age=86400'}
    if status == 206:
        headers['Content-Range'] = f'bytes {start}-{end}/{size}'
    return StreamingResponse(body(), status_code=status, media_type=doc.get('content_type', 'video/mp4'), headers=headers)


# ───────────── administrators only ─────────────
class WallpaperUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=40)
    start: Optional[float] = Field(None, ge=0)
    end: Optional[float] = Field(None, gt=0)
    duration: Optional[float] = Field(None, gt=0)
    a: Optional[str] = None
    b: Optional[str] = None
    poster: Optional[str] = Field(None, description='data:image/jpeg;base64,… of the first loop frame')


@router.post('/admin/wallpapers', status_code=201)
async def upload(request: Request, name: str = Query('', max_length=40), user=Depends(admin)):
    ctype = (request.headers.get('content-type') or '').split(';')[0].strip().lower()
    if ctype not in VIDEO_TYPES:
        raise InvalidInputError('Upload an MP4, WebM or MOV video.')
    if int(request.headers.get('content-length') or 0) > MAX_BYTES:
        raise InvalidInputError(f'The video is larger than {MAX_BYTES // (1024 * 1024)} MB. Trim or compress it first.')
    if await db.wallpapers.count_documents({}) >= MAX_WALLPAPERS:
        raise InvalidInputError(f'There are already {MAX_WALLPAPERS} wallpapers. Delete one before uploading another.')

    grid_in = files().open_upload_stream(name or 'wallpaper', metadata={'content_type': ctype})
    total = 0
    try:
        async for chunk in request.stream():
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_BYTES:
                raise InvalidInputError(f'The video is larger than {MAX_BYTES // (1024 * 1024)} MB. Trim or compress it first.')
            await grid_in.write(chunk)
        if total == 0:
            raise InvalidInputError('The video file is empty.')
        await grid_in.close()
    except BaseException:
        await grid_in.abort()
        raise

    now = _now()
    doc = {'name': (name or 'Wallpaper').strip()[:40] or 'Wallpaper', 'file_id': grid_in._id, 'content_type': ctype,
           'size': total, 'start': 0.0, 'end': None, 'duration': None, 'a': '#8B7CFF', 'b': '#3EE6D0',
           'poster': None, 'has_poster': False, 'uploaded_by': user.get('id'), 'uploaded_by_name': user.get('name'),
           'created_at': now, 'updated_at': now}
    res = await db.wallpapers.insert_one(doc)
    doc['_id'] = res.inserted_id
    return public(doc)


@router.patch('/admin/wallpapers/{wid}')
async def update(wid: str, data: WallpaperUpdate, _=Depends(admin)):
    doc = await _get(wid)
    changes: dict = {}
    if data.name is not None:
        changes['name'] = data.name.strip() or doc.get('name')
    for key in ('a', 'b'):
        value = getattr(data, key)
        if value is not None:
            if not HEX.match(value):
                raise InvalidInputError('Colours must look like #RRGGBB.')
            changes[key] = value.upper()
    if data.duration is not None:
        changes['duration'] = round(data.duration, 3)
    start = data.start if data.start is not None else doc.get('start', 0.0)
    end = data.end if data.end is not None else doc.get('end')
    duration = changes.get('duration', doc.get('duration'))
    if end is not None:
        if end - start < 1:
            raise InvalidInputError('The loop must be at least 1 second long (end after start).')
        if duration and end > duration + 0.5:
            raise InvalidInputError('The loop end is after the end of the video.')
    if data.start is not None:
        changes['start'] = round(data.start, 3)
    if data.end is not None:
        changes['end'] = round(data.end, 3)
    if data.poster is not None:
        m = re.fullmatch(r'data:image/jpeg;base64,([A-Za-z0-9+/=]+)', data.poster)
        if not m:
            raise InvalidInputError('The preview image must be a JPEG.')
        raw = base64.b64decode(m.group(1))
        if len(raw) > MAX_POSTER_BYTES:
            raise InvalidInputError('The preview image is too large.')
        changes['poster'] = raw
        changes['has_poster'] = True
    changes['updated_at'] = _now()
    await db.wallpapers.update_one({'_id': doc['_id']}, {'$set': changes})
    return public({**doc, **changes})


@router.delete('/admin/wallpapers/{wid}')
async def delete(wid: str, _=Depends(admin)):
    doc = await _get(wid)
    try:
        await files().delete(doc['file_id'])
    except NoFile:
        pass
    await db.wallpapers.delete_one({'_id': doc['_id']})
    return {'ok': True}
