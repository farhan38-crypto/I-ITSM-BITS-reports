// Entrance animations for the live-wallpaper themes. When you switch to one, a short
// full-screen piece plays over the app (it never blocks clicks), then the glass panels
// materialise one after another (styles/live.css, keyed off <html data-intro>):
//   GTA     neon stripes sweep across, the name slams in, the stripes sweep away
//   Space   a warp jump: stars stretch into streaks, then a gold flash opens on the new look
//   Arcade  a CRT switches on (line → flash), "PLAYER 1 READY" blinks, the screen dissolves in pixels
// Skipped with "Calmer motion" or the device's reduced-motion setting.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/auth'
import { isLive, type LiveId } from '../themes'

const LENGTH: Record<LiveId, number> = { gta: 1500, space: 1500, arcade: 1600 }

export function ThemeIntro() {
  const { themeId, prefs } = useAuth()
  const prev = useRef(themeId)
  const [play, setPlay] = useState<{ id: LiveId; key: number } | null>(null)
  useEffect(() => {
    if (prev.current === themeId) return
    prev.current = themeId
    if (!isLive(themeId) || prefs.reduce_motion || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    setPlay({ id: themeId, key: Date.now() })
    root.dataset.intro = themeId
    const end = window.setTimeout(() => { setPlay(null); delete root.dataset.intro }, LENGTH[themeId] + 700)
    return () => window.clearTimeout(end)
  }, [themeId, prefs.reduce_motion])
  if (!play) return null
  const body = play.id === 'gta' ? <GtaIntro /> : play.id === 'space' ? <SpaceIntro /> : <ArcadeIntro />
  return createPortal(<div key={play.key} className={`intro intro-${play.id}`} aria-hidden>{body}</div>, document.body)
}

function GtaIntro() {
  return <>
    <i className="gta-band" style={{ background: '#FF5FA8' }} />
    <i className="gta-band" style={{ background: '#FFB04A', animationDelay: '.07s' }} />
    <i className="gta-band" style={{ background: '#8F6BFF', animationDelay: '.14s' }} />
    <div className="gta-word"><b>GTA</b><small>live wallpaper</small></div>
  </>
}

function SpaceIntro() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!, g = cv.getContext('2d')!
    const dpr = Math.min(devicePixelRatio || 1, 1.5)
    const w = cv.width = Math.round(innerWidth * dpr), h = cv.height = Math.round(innerHeight * dpr)
    const cx = w / 2, cy = h / 2
    const stars = Array.from({ length: 420 }, () => ({ a: Math.random() * Math.PI * 2, d: Math.random() * 0.9 + 0.02, s: Math.random() * 0.6 + 0.4 }))
    const t0 = performance.now(); let raf = 0
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / 1100)
      const speed = 0.004 + 0.07 * t * t * t
      g.fillStyle = `rgba(4,3,2,${0.35 + 0.4 * (1 - t)})`; g.fillRect(0, 0, w, h)
      g.lineCap = 'round'
      for (const s of stars) {
        const r0 = s.d * Math.hypot(cx, cy)
        s.d += speed * s.s * (0.3 + s.d)
        if (s.d > 1.4) s.d = Math.random() * 0.1 + 0.02
        const r1 = s.d * Math.hypot(cx, cy)
        const warm = s.s > 0.8
        g.strokeStyle = warm ? `rgba(255,200,140,${0.5 + 0.5 * t})` : `rgba(210,225,255,${0.5 + 0.5 * t})`
        g.lineWidth = dpr * (0.6 + 1.6 * t * s.s)
        g.beginPath(); g.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0); g.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1); g.stroke()
      }
      if (t < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <><canvas ref={ref} className="space-warp" /><i className="space-flash" /></>
}

function ArcadeIntro() {
  const cols = 16, rows = 9
  const cells = useMemo(() => Array.from({ length: cols * rows }, () => Math.random()), [])
  return <>
    <div className="arc-crt"><i /></div>
    <div className="arc-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
      {cells.map((r, i) => <i key={i} style={{ animationDelay: `${0.75 + r * 0.6}s` }} />)}
    </div>
    <div className="arc-ready"><b>PLAYER 1</b><span>READY</span></div>
  </>
}
