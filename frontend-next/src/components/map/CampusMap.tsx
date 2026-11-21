// The campus map panel: Google Maps when a key is configured, otherwise the real campus from
// satellite photos / a street map (MapLibre); the drawn campus view only if map tiles can't load. Pins glow in their priority colour; busy buildings get a ring; the selected
// report opens a card with "Open report" and "Navigate".
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { CircleDot, Radio } from 'lucide-react'
import { toast } from 'sonner'
import { api, useQuery, setCached, invalidate } from '../../api'
import { useAuth } from '../../lib/auth'
import { priorityHex } from '../../lib/themes'
import type { Building, CampusMapData, Hotspot, MapPoint } from '../../api'
import { useMapDark } from './tone'
import { GoogleCampusMap } from './GoogleCampusMap'
import { OfflineCampusMap } from './OfflineCampusMap'

import { PinCard } from './PinCard'
import { pointAt } from '../../lib/store'

const RealCampusMap = lazy(() => import('./RealCampusMap').then(m => ({ default: m.RealCampusMap })))
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined

export const useBuildings = () => useQuery('buildings', () => api.campus.buildings(), { staleMs: 300_000 })
/** Open reports from the last 30 days, or every report (open and closed) from the last `hours` hours (Map page time filter). */
export function useCampusData(hours?: number) {
  const { data, reload } = useQuery<CampusMapData>(hours ? `campus-map:h${hours}` : 'campus-map', () => api.campus.map(30, !!hours, hours))
  const { data: buildings } = useBuildings()
  const moveBuilding = useMoveBuilding()
  return { data: data ?? null, buildings: buildings ?? null, reload, moveBuilding }
}

/** Admin moved a building onto its real roof: the reports pinned to that building move with it,
 *  so every map and report reloads its pins. */
export function useMoveBuilding() {
  return useCallback(async (name: string, lat: number, lng: number) => {
    const res = await api.campus.setPin(name, lat, lng)
    setCached('buildings', { centre: res.centre, buildings: res.buildings })
    invalidate('campus-map', 'reports:')
    if (res.moved_incidents) toast.success(`${name} moved. ${res.moved_incidents} report${res.moved_incidents > 1 ? 's' : ''} moved with it.`)
  }, [])
}


export function CampusMap({ data, buildings, focus, className, style, onMoveBuilding, embedded, size, cooperative, minimal: minimalDefault }: {
  data: CampusMapData | null; buildings: { centre: { lat: number; lng: number }; buildings: Building[] } | null
  focus?: string | null; className?: string; style?: CSSProperties
  onMoveBuilding?: (name: string, lat: number, lng: number) => Promise<void>; embedded?: boolean
  /** big: satellite first (Map page, Classic overview); small: themed street map. */
  size?: 'big' | 'small'
  /** Let the page scroll over the map (zoom with Ctrl/⌘ + scroll). On by default when embedded. */
  cooperative?: boolean
  /** Start with small dot pins (the "Minimal pins" chip toggles it). */
  minimal?: boolean }) {
  const [minimal, setMinimal] = useState(!!minimalDefault)
  const { theme, user } = useAuth()
  const dark = useMapDark()
  const [tilesFailed, setTilesFailed] = useState(false)
  const onTilesFail = useCallback(() => setTilesFailed(true), [])
  const [selected, setSelected] = useState<string | null>(focus || null)
  const [googleFailed, setGoogleFailed] = useState(false)
  useEffect(() => { if (focus) setSelected(focus) }, [focus])
  const colourOf = useCallback((p: MapPoint) => priorityHex(p.priority, theme), [theme])
  const hotColour = useCallback((h: Hotspot) => priorityHex(h.worst_priority, theme), [theme])
  const onFail = useCallback(() => setGoogleFailed(true), [])
  // Legend chips double as filters: click one to hide or show that priority's pins.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const toggle = (p: string) => setHidden(h => { const n = new Set(h); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const points = useMemo(() => (data?.points || []).filter(p => !hidden.has(p.priority)), [data, hidden])
  const sel = data?.points.find(p => p.id === selected) || null
  const useGoogle = !!KEY && !googleFailed

  return (
    <div className={`campus-map ${className || ''}`} style={style} data-minimal={minimal || undefined}>
      {!data || !buildings ? <div className="map-loading"><span />Loading the campus…</div>
        : useGoogle
          ? <GoogleCampusMap apiKey={KEY!} mapId={MAP_ID} dark={dark} points={points} hotspots={data.hotspots}
              buildings={buildings.buildings} centre={buildings.centre} colourOf={colourOf} hotColour={hotColour}
              selected={selected} onSelect={setSelected} onFail={onFail} />
          : !tilesFailed
            ? <Suspense fallback={<div className="map-loading"><span />Loading the campus…</div>}><RealCampusMap dark={dark} points={points} hotspots={data.hotspots} buildings={buildings.buildings}
                centre={buildings.centre} colourOf={colourOf} hotColour={hotColour} selected={selected} onSelect={setSelected}
                onFail={onTilesFail} canEdit={user?.role === 'admin' && !!onMoveBuilding} onMoveBuilding={onMoveBuilding} cooperative={cooperative ?? embedded} size={size ?? (embedded ? 'small' : 'big')} /></Suspense>
          : <OfflineCampusMap points={points} hotspots={data.hotspots} buildings={buildings.buildings}
              colourOf={colourOf} hotColour={hotColour} selected={selected} onSelect={setSelected} />}

      {data && data.outages.length > 0 && !embedded && (
        <div className="map-overlay map-outages">
          {data.outages.slice(0, 2).map(o => (
            <motion.button type="button" key={o.building} className="outage glass glass-solid" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
              whileTap={{ scale: .98 }} title={`Fly to ${o.building} and open its most urgent report`}
              onClick={() => { const first = [...o.incidents].sort((a, b) => a.priority.localeCompare(b.priority))[0]; if (first) { setHidden(new Set()); setSelected(first.id) } }}
              onPointerEnter={() => pointAt(null, theme.status.P1)} onPointerLeave={() => pointAt(null, null)}>
              <Radio size={16} className="outage-icon" />
              <div><b>Possible outage in {o.building}</b><span>{o.count} reports in {o.window_minutes} min. Check the building first.</span></div>
            </motion.button>
          ))}
        </div>
      )}

      <div className="map-overlay map-legend">
        {[['P1', 'Urgent'], ['P2', 'High'], ['P3', 'Normal'], ['P4', 'Low']].map(([p, l]) => (
          <button type="button" key={p} className="legend-item" data-off={hidden.has(p) || undefined} aria-pressed={!hidden.has(p)}
            title={hidden.has(p) ? `Show ${l.toLowerCase()} reports` : `Hide ${l.toLowerCase()} reports`}
            style={{ '--k': priorityHex(p, theme) } as CSSProperties} onClick={() => toggle(p)}><i />{l}</button>
        ))}
        <button type="button" className="legend-item legend-toggle" aria-pressed={minimal} data-off={!minimal || undefined}
          title={minimal ? 'Show full pins' : 'Show small dots only'} onClick={() => setMinimal(m => !m)}><CircleDot size={12} />Minimal pins</button>
        {!useGoogle && tilesFailed && <span className="legend-note">Map photos couldn't load (offline?), showing the drawn campus view</span>}
      </div>

      <AnimatePresence>
        {sel && <PinCard key={sel.id} p={sel} colour={colourOf(sel)} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}
