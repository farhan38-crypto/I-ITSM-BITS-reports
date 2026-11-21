// An incident pin: a map "drop pin" in the priority colour that falls into place, with a
// shadow on the ground and, for urgent reports, a ring pulsing where it touches down. The same
// element is used on every map (MapLibre, Google and the offline campus view); its tip is
// the exact spot, so markers anchor at the bottom.
import type { CSSProperties } from 'react'

const PATH = 'M14 36.5C14 36.5 25.5 23.2 25.5 13.8A11.5 11.5 0 0 0 2.5 13.8C2.5 23.2 14 36.5 14 36.5Z'

export function Pin({ colour, active, urgent, label, count }: { colour: string; active?: boolean; urgent?: boolean; label?: string; count?: number }) {
  return (
    <span className="pin" data-active={active || undefined} data-urgent={urgent || undefined} style={{ '--k': colour } as CSSProperties}>
      <i className="pin-shadow" /><i className="pin-ring" /><i className="pin-ring r2" />
      <svg className="pin-shape" viewBox="0 0 28 38" width="28" height="38" aria-hidden><path d={PATH} /></svg>
      <span className="pin-core">{count && count > 1 ? count : ''}</span>
      {label && <span className="pin-label">{label}</span>}
    </span>
  )
}

/** The same pin as plain HTML, for maps that take an element instead of React (MiniMap). */
export const pinHtml = () => `<i class="pin-shadow"></i><i class="pin-ring"></i><svg class="pin-shape" viewBox="0 0 28 38" width="28" height="38" aria-hidden="true"><path d="${PATH}"/></svg><span class="pin-core"></span>`

export function HotspotRing({ colour, count }: { colour: string; count: number }) {
  const size = 70 + Math.min(count, 8) * 14
  return <span className="hotspot" style={{ '--k': colour, width: size, height: size } as CSSProperties} aria-hidden />
}
