// Backdrops for the live-wallpaper themes (themes/live.ts):
//  • VideoBackdrop: a muted 15-second loop, faded in once it plays, with a tint so glass and text stay readable.
//    Paused (poster only) when "Calmer motion" is on or the tab is hidden.
//  • ArcadeBackdrop: a retro scene drawn on a small canvas and scaled up with crisp pixels:
//    starry sky, a striped sunset sun, pixel mountains, a neon grid rolling toward you and
//    the odd UFO drifting by. Runs at 30 fps and stops when the tab is hidden.
import { useEffect, useRef, useState } from 'react'

export function VideoBackdrop({ src, poster, tint, still, dim, loop }: { src: string; poster?: string; tint?: string; still: boolean; dim: number; loop?: { start: number; end?: number | null } }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { setPlaying(false) }, [src])
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const sync = () => { if (still || document.hidden) v.pause(); else v.play().catch(() => {}) }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [still, src])
  // Loop only the chosen part: start there, and jump back when the end is reached (checked every frame).
  const from = loop?.start || 0, to = loop?.end ?? null
  useEffect(() => {
    const v = ref.current
    if (!v || (!from && to == null)) return
    const toStart = () => { if (Math.abs(v.currentTime - from) > 0.05) v.currentTime = from }
    const ended = () => { v.currentTime = from; if (!still) v.play().catch(() => {}) }
    if (v.readyState >= 1) toStart()
    v.addEventListener('loadedmetadata', toStart)
    v.addEventListener('ended', ended)
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const end = to ?? v.duration
      if (!v.paused && end && v.currentTime >= end - 0.04) v.currentTime = from
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); v.removeEventListener('loadedmetadata', toStart); v.removeEventListener('ended', ended) }
  }, [src, from, to, still])
  const ranged = !!from || to != null
  return (
    <>
      {poster && <img className="live-media" src={poster} alt="" draggable={false} />}
      <video ref={ref} key={src} className="live-media live-video" data-on={playing || undefined} src={src} poster={poster}
        muted loop={!ranged} playsInline autoPlay={!still} preload="auto" disablePictureInPicture onPlaying={() => setPlaying(true)} />
      {tint && <div className="live-layer" style={{ background: tint }} />}
      <div className="live-layer live-vignette" style={{ opacity: dim }} />
    </>
  )
}

// ── Arcade ──
const PX = 3                          // one drawn pixel = 3 screen pixels
const UFO = ['..####..', '.######.', '##.##.##', '########', '.#.##.#.']   // our own 8×5 sprite
type Star = { x: number; y: number; p: number; s: number }
type Ship = { x: number; y: number; v: number; c: string }

export function ArcadeBackdrop({ still, dim }: { still: boolean; dim: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!, g = cv.getContext('2d')!
    let w = 0, h = 0, horizon = 0, raf = 0, last = 0, t0 = performance.now()
    let stars: Star[] = [], ships: Ship[] = [], ridge: number[] = []
    const rnd = (a: number, b: number) => a + Math.random() * (b - a)
    const size = () => {
      w = Math.ceil(innerWidth / PX); h = Math.ceil(innerHeight / PX); cv.width = w; cv.height = h
      horizon = Math.round(h * 0.6)
      stars = Array.from({ length: Math.round(w * h / 260) }, () => ({ x: rnd(0, w) | 0, y: rnd(0, horizon - 8) | 0, p: rnd(0, 6.28), s: rnd(.6, 2.2) }))
      // pixel mountains: two layered ridges built from random walks
      ridge = []; let y = 0
      for (let x = 0; x < w; x++) { y = Math.max(-28, Math.min(-4, y + (Math.random() < .5 ? -1 : 1) * (Math.random() < .35 ? 2 : 1))); ridge.push(y) }
      ships = []
    }
    const draw = (now: number) => {
      const t = (now - t0) / 1000
      // sky
      const sky = g.createLinearGradient(0, 0, 0, horizon)
      sky.addColorStop(0, '#07021A'); sky.addColorStop(.55, '#1B0640'); sky.addColorStop(.85, '#5A0B5E'); sky.addColorStop(1, '#B3166E')
      g.fillStyle = sky; g.fillRect(0, 0, w, horizon)
      // stars (twinkle)
      for (const s of stars) {
        const a = .35 + .65 * Math.max(0, Math.sin(s.p + t * s.s))
        g.fillStyle = `rgba(220,240,255,${a.toFixed(2)})`; g.fillRect(s.x, s.y, 1, 1)
      }
      // sun with sliding gaps
      const r = Math.round(Math.min(w, h) * 0.2), cx = Math.round(w / 2), cy = horizon - Math.round(r * 0.35)
      const sun = g.createLinearGradient(0, cy - r, 0, cy + r)
      sun.addColorStop(0, '#FFE600'); sun.addColorStop(.5, '#FF8A3D'); sun.addColorStop(1, '#FF2BD6')
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip()
      g.fillStyle = sun; g.fillRect(cx - r, cy - r, r * 2, r * 2)
      const scroll = (t * 6) % 10
      for (let k = 0; k < 9; k++) {
        const gy = cy + k * 10 - 10 + scroll, gh = 1 + k * 0.6
        if (gy > cy - r * 0.15) { g.fillStyle = '#5A0B5E'; g.fillRect(cx - r, Math.round(gy), r * 2, Math.round(gh)) }
      }
      g.restore()
      // sun glow
      const glow = g.createRadialGradient(cx, cy, r * .8, cx, cy, r * 2.2)
      glow.addColorStop(0, 'rgba(255,60,180,.25)'); glow.addColorStop(1, 'rgba(255,60,180,0)')
      g.fillStyle = glow; g.fillRect(0, 0, w, horizon)
      // mountains
      g.fillStyle = '#12052E'
      for (let x = 0; x < w; x++) { const y = ridge[x]!; g.fillRect(x, horizon + y, 1, -y) }
      g.fillStyle = '#FF2BD6'
      for (let x = 0; x < w; x++) g.fillRect(x, horizon + ridge[x]!, 1, 1)
      // UFOs: rarely, one drifts across the sky
      if (ships.length < 2 && Math.random() < 0.004) {
        const left = Math.random() < .5
        ships.push({ x: left ? -10 : w + 2, y: rnd(10, horizon * .45) | 0, v: (left ? 1 : -1) * rnd(8, 16), c: Math.random() < .5 ? '#00E5FF' : '#5CFF8A' })
      }
      ships = ships.filter(s => s.x > -12 && s.x < w + 12)
      for (const s of ships) {
        s.x += s.v / 30
        const bob = Math.round(Math.sin(t * 3 + s.y) * 1.2)
        g.fillStyle = s.c
        UFO.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') g.fillRect(Math.round(s.x) + i, s.y + j + bob, 1, 1) })
        if (Math.floor(t * 4) % 2) { g.fillStyle = '#FFE600'; g.fillRect(Math.round(s.x) + 3, s.y + 5 + bob, 2, 1) }
      }
      // floor
      const floor = g.createLinearGradient(0, horizon, 0, h)
      floor.addColorStop(0, '#2A0450'); floor.addColorStop(1, '#07021A')
      g.fillStyle = floor; g.fillRect(0, horizon, w, h - horizon)
      // grid: horizontal lines rolling toward you (perspective), verticals fanning from the vanishing point
      const depth = h - horizon, phase = (t * 0.9) % 1
      for (let i = 0; i < 14; i++) {
        const z = (i + 1 - phase) / 14, y = horizon + Math.round(depth * z * z)
        g.fillStyle = `rgba(255,43,214,${(0.25 + 0.75 * z).toFixed(2)})`; g.fillRect(0, y, w, 1)
      }
      g.fillStyle = 'rgba(0,229,255,.75)'
      for (let k = -18; k <= 18; k++) {
        const xb = cx + k * (w / 9)
        for (let y = horizon; y < h; y += 1) {
          const f = (y - horizon) / depth
          g.fillRect(Math.round(cx + (xb - cx) * f), y, 1, 1)
        }
      }
      g.fillStyle = '#FF2BD6'; g.fillRect(0, horizon, w, 1)
    }
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (document.hidden || now - last < 33) return
      last = now; draw(now)
    }
    size()
    if (still) draw(performance.now()); else raf = requestAnimationFrame(loop)
    const onResize = () => { size(); draw(performance.now()) }
    addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize) }
  }, [still])
  return (
    <>
      <canvas ref={ref} className="live-media arcade-canvas" />
      <div className="live-layer arcade-scan" />
      <div className="live-layer arcade-shade" />
      <div className="live-layer live-vignette" style={{ opacity: dim }} />
    </>
  )
}
