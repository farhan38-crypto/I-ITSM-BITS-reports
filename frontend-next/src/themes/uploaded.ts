// Wallpapers uploaded by an administrator (backend/app/routers/wallpapers.py). Each one becomes a
// glass theme in the "Live wallpapers" family: the video loops between the start and end the admin
// chose, the accents are the admin's two colours, and switching to it uses the normal circle reveal.
// Everyone can pick them; only admins can upload (Appearance → Upload video).
// The list is cached on this device so a saved choice shows straight away on the next visit.
import { useSyncExternalStore } from 'react'
import { registerTheme, unregisterTheme } from './registry'
import type { ThemeDefinition } from './types'

export interface Wallpaper {
  id: string; name: string; start: number; end: number | null; duration: number | null
  a: string; b: string; has_poster: boolean; version: number; size?: number; uploaded_by_name?: string | null
}

const API = ((import.meta.env.VITE_BACKEND_URL as string | undefined) || '').replace(/\/$/, '') + '/api'
export const WALL_PREFIX = 'wall-'
export const wallThemeId = (id: string) => WALL_PREFIX + id
export const isWallThemeId = (id?: string | null) => !!id && /^wall-[a-f0-9]{24}$/.test(id)
export const wallVideoUrl = (w: Pick<Wallpaper, 'id' | 'version'>) => `${API}/wallpapers/${w.id}/video?v=${w.version}`
export const wallPosterUrl = (w: Pick<Wallpaper, 'id' | 'version'>) => `${API}/wallpapers/${w.id}/poster?v=${w.version}`

// ── colours ──
const hexToRgb = (hex: string): [number, number, number] => { const v = parseInt(hex.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255] }
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase()
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6; if (h < 0) h += 1
  return [h, s, l]
}
export function hslToHex(h: number, s: number, l: number) {
  const k = (n: number) => (n + h * 12) % 12, a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255)
}
/** An accent that reads on dark glass: saturated, fairly light. */
export function accentFrom(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#8B7CFF'
  const [h, s, l] = rgbToHsl(...hexToRgb(hex))
  return hslToHex(h, s < 0.12 ? s : Math.min(0.92, Math.max(0.6, s)), Math.min(0.76, Math.max(0.6, l)))
}
const rgba = (hex: string, a: number) => { const [r, g, b] = hexToRgb(hex); return `rgb(${r} ${g} ${b} / ${a})` }

/** Two vivid accent colours from a video frame (drawn on a canvas): the strongest hue, and the next one at least 45° away. */
export function pickAccents(canvas: HTMLCanvasElement): [string, string] {
  const small = document.createElement('canvas'); small.width = 64; small.height = 36
  const g = small.getContext('2d', { willReadFrequently: true })!
  g.drawImage(canvas, 0, 0, 64, 36)
  const px = g.getImageData(0, 0, 64, 36).data
  const bins = Array.from({ length: 24 }, () => ({ w: 0, s: 0, l: 0 }))
  for (let i = 0; i < px.length; i += 4) {
    const [h, s, l] = rgbToHsl(px[i]!, px[i + 1]!, px[i + 2]!)
    const w = s * (l > 0.12 && l < 0.92 ? 1 : 0) * (1 - Math.abs(l - 0.5))
    if (w <= 0.05) continue
    const bin = bins[Math.floor(h * 24) % 24]!
    bin.w += w; bin.s += s * w; bin.l += l * w
  }
  const order = bins.map((b, i) => ({ ...b, i })).filter(b => b.w > 0).sort((x, y) => y.w - x.w)
  if (!order.length) return ['#8B7CFF', '#3EE6D0']
  const first = order[0]!
  const second = order.find(b => Math.min(Math.abs(b.i - first.i), 24 - Math.abs(b.i - first.i)) >= 3)
  const colour = (b: { i: number; s: number; l: number; w: number }) => accentFrom(hslToHex((b.i + 0.5) / 24, b.s / b.w, b.l / b.w))
  const a = colour(first)
  const b = second ? colour(second) : accentFrom(hslToHex(((first.i + 0.5) / 24 + 0.12) % 1, 0.75, 0.66))
  return [a, b]
}

export function wallpaperTheme(w: Wallpaper): ThemeDefinition {
  const a = accentFrom(w.a), b = accentFrom(w.b)
  return {
    id: wallThemeId(w.id), name: w.name, family: 'live', scheme: 'dark', bestFor: ['lcd', 'oled'],
    description: `Live wallpaper added by ${w.uploaded_by_name || 'your administrator'}.`,
    palette: { base: '#06060A', a, b,
      ink: '#F6F5FA', ink2: 'rgb(246 245 250 / .7)', ink3: 'rgb(246 245 250 / .48)',
      glass: 'rgb(10 10 16 / .4)', glassHi: 'rgb(26 26 36 / .52)', glassSolid: 'rgb(12 12 18 / .9)',
      rim: rgba(a, .22), rimTop: rgba(a, .4), rimBottom: 'rgb(255 255 255 / .05)',
      shadow: '0 30px 60px -30px rgb(0 0 0 / .85)', onAccent: '#0A0A12' },
    backdrop: { kind: 'video', src: wallVideoUrl(w), poster: w.has_poster ? wallPosterUrl(w) : undefined,
      loop: { start: w.start || 0, end: w.end },
      tint: 'linear-gradient(90deg, rgb(0 0 0 / .55) 0%, rgb(0 0 0 / .15) 55%, transparent 80%), linear-gradient(180deg, rgb(0 0 0 / .35) 0%, rgb(0 0 0 / .1) 40%, rgb(0 0 0 / .55) 100%)' },
    chart: { series: [a, b] },
  }
}

// ── store ──
const KEY = 'bits_wallpapers'
let list: Wallpaper[] = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } })()
let version = 0
const subs = new Set<() => void>()
list.forEach(w => registerTheme(wallpaperTheme(w)))

/** Take the list from the server: register new and changed wallpapers, drop removed ones. */
export function adoptWallpapers(next: Wallpaper[]) {
  const keep = new Set(next.map(w => w.id))
  list.filter(w => !keep.has(w.id)).forEach(w => unregisterTheme(wallThemeId(w.id)))
  next.forEach(w => registerTheme(wallpaperTheme(w)))
  list = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  version++; subs.forEach(f => f())
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const useWallpapers = () => useSyncExternalStore(subscribe, () => list)
export const useWallpaperVersion = () => useSyncExternalStore(subscribe, () => version)
