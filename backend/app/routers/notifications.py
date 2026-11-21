from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends

from app.core.db import db
from app.core.security import get_current_user
from app.domain.exceptions import ResourceNotFoundError
from app.domain.visibility import can_view
from app.models.schemas import clean_doc

router = APIRouter(prefix='/notifications', tags=['notifications'])


@router.get('')
async def listing(user=Depends(get_current_user)):
    docs = await db.notifications.find({'user_id': user['id']}).sort('created_at', -1).limit(80).to_list(80)
    # Hide notifications about incidents this person can no longer open (reassigned to someone
    # else, deleted), so a tap never lands on "access denied".
    ids = list({d['incident_id'] for d in docs if d.get('incident_id')})
    oids = [ObjectId(i) for i in ids if ObjectId.is_valid(i)]
    incidents = {str(x['_id']): x for x in await db.incidents.find(
        {'_id': {'$in': oids}}, {'reporter_id': 1, 'assigned_to': 1, 'status': 1}).to_list(len(oids) or 1)}
    docs = [d for d in docs if not d.get('incident_id') or can_view(user, incidents.get(d['incident_id']))][:50]
    unread = sum(not d.get('read', False) for d in docs)
    return {'items': [clean_doc(x) for x in docs], 'unread': unread}


@router.post('/{nid}/read')
async def read(nid, user=Depends(get_current_user)):
    try:
        notification_id = ObjectId(nid)
    except InvalidId as exc:
        raise ResourceNotFoundError('Notification not found') from exc
    result = await db.notifications.update_one(
        {'_id': notification_id, 'user_id': user['id']}, {'$set': {'read': True}})
    if not result.matched_count:
        raise ResourceNotFoundError('Notification not found')
    return {'ok': True}


@router.post('/read-all')
async def all_read(user=Depends(get_current_user)):
    await db.notifications.update_many({'user_id': user['id'], 'read': False}, {'$set': {'read': True}})
    return {'ok': True}
