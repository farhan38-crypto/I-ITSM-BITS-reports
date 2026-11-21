// Admin-only part of the Appearance panel: upload a video as a live wallpaper for everyone,
// choose the part that loops (start and end), and its two accent colours. Students never see
// this; they can only pick the wallpapers an admin published (backend checks the role too).
import { Clapperboard, Pencil, Trash2, Upload, X, Play, Pause, Pipette, Film } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { api, errorMessage, type Wallpaper } from '../api'
import { useAuth } from '../lib/auth'
import { adoptWallpapers, accentFrom, pickAccents, useWallpapers, wallPosterUrl, wallThemeId, wallVideoUrl } from '../themes'
import { Button, Spinner } from '../ui/Controls'

const MAX_MB = 300
const MIN_LOOP = 1
const fmt = (t: number | null | undefined) => {
  if (t == null || !isFinite(t)) return '–'
  const m = Math.floor(t / 60), s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
const mb = (bytes?: number) => bytes ? `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB` : ''
const refresh = () => api.wallpapers.list().then(adoptWallpapers)

export function WallpaperAdmin() {
  const list = useWallpapers()
  const { theme, setTheme } = useAuth()
  const [edit, setEdit] = useState<Wallpaper | 'new' | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { refresh().catch(() => {}) }, [])

  const remove = async (w: Wallpaper) => {
    setBusy(w.id); setError('')
    try { await api.wallpapers.remove(w.id); await refresh() } catch (e) { setError(errorMessage(e)) }
    finally { setBusy(null); setConfirm(null) }
  }

  return (
    <section className="ap-walls">
      <header>
        <div>
          <h3><Clapperboard size={15} />Live wallpapers for everyone</h3>
          <p>Upload a video and choose the part that loops. Every account can pick it here; students can’t upload. Only admins see this box.</p>
        </div>
        <button type="button" className="btn btn-primary sm" onClick={() => setEdit('new')}><Upload size={14} />Upload video</button>
      </header>
      {list.length === 0 ? <p className="ap-walls-empty">No uploaded wallpapers yet.</p> : (
        <ul>{list.map(w => {
          const on = theme.id === wallThemeId(w.id)
          return (
            <li key={w.id}>
              <span className="ap-walls-thumb" style={w.has_poster ? { backgroundImage: `url(${wallPosterUrl(w)})` } : undefined}>{!w.has_poster && <Film size={16} />}</span>
              <span className="ap-walls-info"><b>{w.name}</b><small>Loop {fmt(w.start)} – {fmt(w.end ?? w.duration)}{w.size ? ` · ${mb(w.size)}` : ''}</small></span>
              <span className="ap-walls-dots" aria-hidden><i style={{ background: accentFrom(w.a) }} /><i style={{ background: accentFrom(w.b) }} /></span>
              <button type="button" className="btn sm" disabled={on} onClick={e => setTheme(wallThemeId(w.id), { x: e.clientX, y: e.clientY })}>{on ? 'In use' : 'Use'}</button>
              <button type="button" className="icon-btn" title="Edit loop, name and colours" aria-label={`Edit ${w.name}`} onClick={() => setEdit(w)}><Pencil size={15} /></button>
              {confirm === w.id
                ? <span className="ap-walls-confirm"><Button variant="danger" className="sm" busy={busy === w.id} onClick={() => remove(w)}>Delete</Button>
                    <button type="button" className="btn sm" onClick={() => setConfirm(null)}>Keep</button></span>
                : <button type="button" className="icon-btn" title="Delete for everyone" aria-label={`Delete ${w.name}`} onClick={() => setConfirm(w.id)}><Trash2 size={15} /></button>}
            </li>
          )
        })}</ul>
      )}
      {error && <p className="ap-walls-error" role="alert">{error}</p>}
      {edit && createPortal(
        <WallpaperEditor existing={edit === 'new' ? null : edit} onClose={() => setEdit(null)}
          onSaved={async w => { await refresh().catch(() => {}); setEdit(null); setTheme(wallThemeId(w.id)) }} />,
        document.body)}
    </section>
  )
}

function frameCanvas(v: HTMLVideoElement, width = 960) {
  const c = document.createElement('canvas')
  c.width = width; c.height = Math.round(width * (v.videoHeight || 9) / (v.videoWidth || 16))
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
  return c
}
const seekTo = (v: HTMLVideoElement, t: number) => new Promise<void>(res => {
  if (Math.abs(v.currentTime - t) < 0.01 && v.readyState >= 2) return res()
  const done = () => { v.removeEventListener('seeked', done); res() }
  v.addEventListener('seeked', done); v.currentTime = t
})

function WallpaperEditor({ existing, onClose, onSaved }: { existing: Wallpaper | null; onClose: () => void; onSaved: (w: Wallpaper) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [src, setSrc] = useState(existing ? wallVideoUrl(existing) : '')
  const [name, setName] = useState(existing?.name || '')
  const [duration, setDuration] = useState(existing?.duration || 0)
  const [start, setStart] = useState(existing?.start ?? 0)
  const [end, setEnd] = useState(existing?.end ?? 0)
  const [a, setA] = useState(existing?.a || '#8B7CFF')
  const [b, setB] = useState(existing?.b || '#3EE6D0')
  const [now, setNow] = useState(existing?.start ?? 0)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const autoColour = useRef(!existing)
  const video = useRef<HTMLVideoElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const loopRef = useRef({ start, end }); loopRef.current = { start, end }

  // Esc closes the editor only (not the Appearance panel behind it).
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) { e.stopPropagation(); onClose() } }
    addEventListener('keydown', esc, true)
    return () => removeEventListener('keydown', esc, true)
  }, [onClose, saving])
  useEffect(() => () => { if (src.startsWith('blob:')) URL.revokeObjectURL(src) }, [src])

  // Preview plays only the chosen loop, and the playhead follows.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const v = video.current
      if (!v) return
      const { start: s, end: e } = loopRef.current
      if (!v.paused && e && (v.currentTime >= e - 0.04 || v.currentTime < s - 0.25)) v.currentTime = s
      setNow(v.currentTime)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const choose = (f?: File | null) => {
    if (!f) return
    setError('')
    if (!/^video\/(mp4|webm|quicktime)$/.test(f.type)) { setError('Choose an MP4, WebM or MOV video.'); return }
    if (f.size > MAX_MB * 1024 * 1024) { setError(`That video is ${mb(f.size)}. The limit is ${MAX_MB} MB.`); return }
    setFile(f); setSrc(URL.createObjectURL(f)); autoColour.current = true
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 40))
  }

  const loaded = () => {
    const v = video.current!
    const d = v.duration || 0
    setDuration(d)
    if (!existing) { setStart(0); setEnd(Math.min(d, 15)) }
    else if (!existing.end) setEnd(d)
    v.currentTime = existing?.start ?? 0
  }
  const seeked = () => {
    if (!autoColour.current || !video.current) return
    autoColour.current = false
    try { const [x, y] = pickAccents(frameCanvas(video.current, 320)); setA(x); setB(y) } catch { /* frame not readable */ }
  }
  const fromVideo = () => {
    try { const [x, y] = pickAccents(frameCanvas(video.current!, 320)); setA(x); setB(y) } catch { setError('Could not read colours from this frame.') }
  }
  const toggle = () => {
    const v = video.current!
    if (v.paused) { if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start; v.play().catch(() => {}) } else v.pause()
  }

  // ── timeline: drag the two handles, click to move the playhead ──
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }
  const drag = (which: 'start' | 'end') => (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget; el.setPointerCapture(e.pointerId)
    video.current?.pause()
    const move = (ev: PointerEvent) => {
      const t = Math.round(timeAt(ev.clientX) * 10) / 10
      if (which === 'start') { const s = Math.min(t, loopRef.current.end - MIN_LOOP); setStart(Math.max(0, s)); if (video.current) video.current.currentTime = Math.max(0, s) }
      else { const en = Math.max(t, loopRef.current.start + MIN_LOOP); setEnd(Math.min(duration, en)); if (video.current) video.current.currentTime = Math.min(duration, en) }
    }
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  const seekTrack = (e: RPointerEvent<HTMLDivElement>) => { if (video.current && duration) video.current.currentTime = timeAt(e.clientX) }
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`
  const setStartNum = (v: number) => { if (!isNaN(v)) setStart(Math.max(0, Math.min(v, end - MIN_LOOP))) }
  const setEndNum = (v: number) => { if (!isNaN(v)) setEnd(Math.min(duration, Math.max(v, start + MIN_LOOP))) }

  const save = async () => {
    setError('')
    const clean = name.trim()
    if (!clean) { setError('Give the wallpaper a name.'); return }
    if (!duration) { setError('The video has not loaded yet.'); return }
    if (end - start < MIN_LOOP) { setError('The loop must be at least 1 second long.'); return }
    const v = video.current!
    setSaving(true)
    try {
      v.pause()
      await seekTo(v, start)
      let poster = frameCanvas(v).toDataURL('image/jpeg', 0.8)
      if (poster.length > 760_000) poster = frameCanvas(v, 640).toDataURL('image/jpeg', 0.7)
      let w = existing
      if (file) { setProgress(0); w = await api.wallpapers.upload(file, clean, setProgress) }
      w = await api.wallpapers.update(w!.id, { name: clean, start: +start.toFixed(2), end: +end.toFixed(2), duration: +duration.toFixed(2), a, b, poster })
      onSaved(w)
    } catch (e) {
      setError(errorMessage(e))
    } finally { setSaving(false); setProgress(null) }
  }

  const look = { '--wa': accentFrom(a), '--wb': accentFrom(b) } as CSSProperties
  return (
    <>
      <div className="we-scrim" onClick={() => !saving && onClose()} />
      <div className="we" role="dialog" aria-modal="true" aria-label={existing ? `Edit ${existing.name}` : 'Upload a live wallpaper'} style={look}>
        <header className="we-head">
          <div><h2>{existing ? 'Edit live wallpaper' : 'Upload a live wallpaper'}</h2>
            <p>{existing ? 'Change the loop, name or colours. Everyone using it sees the change on their next visit.' : 'Pick a video, drag the handles to choose the part that loops, and publish it for everyone.'}</p></div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={saving} aria-label="Close"><X size={18} /></button>
        </header>

        {!src ? (
          <label className="we-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files[0]) }}>
            <Upload size={26} />
            <b>Choose a video or drop it here</b>
            <small>MP4, WebM or MOV, up to {MAX_MB} MB. Muted, so sound doesn’t matter. Shorter, 1080p clips load faster for everyone.</small>
            <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e => choose(e.target.files?.[0])} />
          </label>
        ) : (
          <div className="we-body">
            <div className="we-stage">
              <video ref={video} src={src} muted playsInline preload="auto" crossOrigin={src.startsWith('blob:') ? undefined : 'anonymous'}
                onLoadedMetadata={loaded} onSeeked={seeked} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
              <div className="we-tint" />
              {/* a sample of the glass so the colours can be judged on the video */}
              <div className="we-sample">
                <b>Glass preview</b><s /><s style={{ width: '60%' }} />
                <span className="we-sample-btn">Sign in</span>
              </div>
            </div>

            <div className="we-timeline">
              <button type="button" className="we-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play the loop'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
              <div className="we-track" ref={track} onPointerDown={seekTrack}>
                <div className="we-range" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
                <i className="we-head-line" style={{ left: pct(now) }} />
                <button type="button" className="we-handle" style={{ left: pct(start) }} onPointerDown={drag('start')} aria-label={`Loop start ${fmt(start)}`} />
                <button type="button" className="we-handle" style={{ left: pct(end) }} onPointerDown={drag('end')} aria-label={`Loop end ${fmt(end)}`} />
              </div>
              <span className="we-time tabular">{fmt(now)} / {fmt(duration)}</span>
            </div>

            <div className="we-row">
              <label className="we-num"><span>Loop start (s)</span>
                <input className="input" type="number" min={0} step={0.1} value={+start.toFixed(1)} onChange={e => setStartNum(parseFloat(e.target.value))} /></label>
              <button type="button" className="btn sm" onClick={() => setStartNum(Math.round(now * 10) / 10)}>Start here</button>
              <label className="we-num"><span>Loop end (s)</span>
                <input className="input" type="number" min={0} step={0.1} value={+end.toFixed(1)} onChange={e => setEndNum(parseFloat(e.target.value))} /></label>
              <button type="button" className="btn sm" onClick={() => setEndNum(Math.round(now * 10) / 10)}>End here</button>
              <span className="we-len">Loops <b className="tabular">{(end - start).toFixed(1)} s</b></span>
            </div>

            <div className="we-row">
              <label className="we-name"><span>Name</span>
                <input className="input" value={name} maxLength={40} placeholder="e.g. Campus at night" onChange={e => setName(e.target.value)} /></label>
              <label className="we-colour"><span>Accent</span><input type="color" value={a} onChange={e => setA(e.target.value.toUpperCase())} /></label>
              <label className="we-colour"><span>Second</span><input type="color" value={b} onChange={e => setB(e.target.value.toUpperCase())} /></label>
              <button type="button" className="btn sm" onClick={fromVideo} title="Take both colours from the frame shown"><Pipette size={14} />From video</button>
            </div>
            {!existing && <label className="we-replace">Different video? <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e => choose(e.target.files?.[0])} /></label>}
          </div>
        )}

        <footer className="we-foot">
          {error && <p className="we-error" role="alert">{error}</p>}
          {progress != null && <div className="we-progress" aria-label="Upload progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /><span>{progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : 'Saving…'}</span></div>}
          <div className="we-actions">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={!src || saving}>
              {saving && <Spinner />}{existing ? 'Save changes' : 'Upload and publish'}</button>
          </div>
        </footer>
      </div>
    </>
  )
}
