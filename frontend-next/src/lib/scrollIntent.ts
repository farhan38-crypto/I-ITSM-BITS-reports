// Page scroll vs. inner scroll. While someone is scrolling the page, a list, table or panel
// that slides under the pointer must not grab the wheel (it used to: a quick flick down the
// overview stopped dead inside "Needs attention"). The rule, like a trackpad's latching:
//   - a wheel gesture that starts on the page stays with the page until the wheel rests for
//     ~0.4 s, even when it passes over an inner scroller;
//   - a gesture that starts over an inner scroller (pointer resting there first) scrolls it.
// Maps manage their own gestures (Ctrl/⌘ + scroll), and dialogs and menus are left alone.
const IDLE_MS = 420
let latch: 'page' | 'inner' | null = null
let last = 0
let started = false

const OVERLAYS = '.ov, .ov-panel, .pop, .ap, .cp, [role="dialog"], [data-scroll-own]'
const MAP = '.maplibregl-map, .gmap'

function innerScroller(start: Element | null): HTMLElement | null {
  for (let el = start as HTMLElement | null; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll') return el
    }
  }
  return null
}

export function startScrollIntent() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    const target = e.target as Element | null
    if (target?.closest?.(OVERLAYS)) { latch = null; return }
    const now = performance.now()
    // An embedded map lets plain scrolling through to the page (it zooms with Ctrl/⌘).
    if (target?.closest?.(MAP)) { if (now - last > IDLE_MS) latch = 'page'; last = now; return }
    if (now - last > IDLE_MS) latch = innerScroller(target) ? 'inner' : 'page'
    last = now
    if (latch !== 'page' || !innerScroller(target)) return
    // The page gesture is passing over an inner scroller: keep scrolling the page.
    e.preventDefault()
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
    window.scrollBy({ top: e.deltaY * k, behavior: 'instant' as ScrollBehavior })
  }, { passive: false, capture: true })
}
