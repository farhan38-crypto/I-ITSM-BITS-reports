// "Where exactly are you?" for on-site reports. Technicians use the phone's location to walk
// straight to the spot, so it's asked for as soon as an on-site place is chosen, shown big,
// and skipping it needs a deliberate "continue without" (see confirmSkip).
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, LocateFixed, MapPin, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '../../ui/Controls'

export interface Gps { lat: number; lng: number; acc: number }
type State = 'idle' | 'asking' | 'denied' | 'unavailable'

export function LocationCard({ gps, onChange, auto }: { gps: Gps | null; onChange: (g: Gps | null) => void; auto?: boolean }) {
  const [state, setState] = useState<State>('idle')
  const asked = useRef(false)
  const locate = () => {
    if (!navigator.geolocation) { setState('unavailable'); return }
    setState('asking')
    navigator.geolocation.getCurrentPosition(
      p => { onChange({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setState('idle') },
      e => setState(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 })
  }
  // Ask once, as soon as the card appears (the person just chose an on-site place).
  useEffect(() => { if (auto && !gps && !asked.current) { asked.current = true; locate() } }, [auto]) // eslint-disable-line react-hooks/exhaustive-deps

  const ok = !!gps
  return (
    <div className="loc-card" data-state={ok ? 'ok' : state} role="group" aria-label="Your exact location">
      <span className="loc-icon">{ok ? <CheckCircle2 size={22} /> : state === 'denied' || state === 'unavailable' ? <TriangleAlert size={22} /> : <MapPin size={22} />}</span>
      <div className="loc-text">
        <b>{ok ? 'Your location is added' : state === 'asking' ? 'Finding you…' : state === 'denied' ? 'Location is blocked' : state === 'unavailable' ? 'Couldn’t find you' : 'Share your exact location'}</b>
        <small>{ok ? `Accurate to about ${Math.round(gps!.acc)} m. The technician gets directions to this spot.`
          : state === 'denied' ? 'Allow location for this site in the browser’s address bar, then try again.'
          : state === 'unavailable' ? 'Move near a window or turn on location services, then try again.'
          : 'The technician walks straight to you instead of searching the building. Strongly recommended.'}</small>
      </div>
      {ok
        ? <div className="loc-actions"><Button className="sm" variant="quiet" icon={<RefreshCw size={14} />} onClick={locate}>Update</Button>
            <button type="button" className="link small" onClick={() => onChange(null)}>Remove</button></div>
        : <Button variant="primary" icon={<LocateFixed size={16} />} busy={state === 'asking'} onClick={locate}>{state === 'idle' ? 'Share my location' : 'Try again'}</Button>}
    </div>
  )
}

/** Before continuing without a location on an on-site report: returns true to continue. */
export const confirmSkip = (confirm: (a: { title: string; body?: React.ReactNode; confirm?: string; danger?: boolean }) => Promise<boolean>) =>
  confirm({
    title: 'Continue without your location?',
    body: 'The technician will only have the building’s pin and may need to call you to find the exact spot. Sharing your location takes a second.',
    confirm: 'Continue without it',
  })
