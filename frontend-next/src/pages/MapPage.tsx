import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { CampusMap, useCampusData } from '../components/map/CampusMap'
import { useAuth } from '../lib/auth'
import { priorityHex } from '../lib/themes'
import { pointAt, useHovered } from '../lib/store'
import { Segmented } from '../ui/Controls'

const RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 }
// Time filter: 'open' = every open report (last 30 days); the others show all reports created in that window.
const WINDOWS = [{ value: 'open', label: 'Open', hours: 0 }, { value: '1h', label: '1 hr', hours: 1 }, { value: '6h', label: '6 hr', hours: 6 },
  { value: '1d', label: '1 day', hours: 24 }, { value: '7d', label: '7 days', hours: 168 }, { value: '30d', label: 'Month', hours: 720 }] as const
type Win = typeof WINDOWS[number]['value']

export default function MapPage() {
  const [params, setParams] = useSearchParams()
  const focus = params.get('focus')
  const [win, setWin] = useState<Win>('open')
  const hours = WINDOWS.find(w => w.value === win)!.hours || undefined
  const { data, buildings, moveBuilding } = useCampusData(hours)
  const { theme, user } = useAuth()
  const hovered = useHovered()
  const list = (data?.points || []).slice().sort((a, b) => RANK[a.priority] - RANK[b.priority])
  return (
    <main className="map-page">
      <CampusMap data={data} buildings={buildings} focus={focus} className="map-full" onMoveBuilding={moveBuilding} minimal={user?.role === 'admin'} />
      <motion.aside className="map-list glass glass-solid" initial={{ opacity: 0, x: 30, filter: 'blur(8px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
        transition={{ delay: .2, type: 'spring', stiffness: 200, damping: 26 }}>
        <h2>On the map <span className="label tabular">{list.length}</span></h2>
        <Segmented size="sm" label="Time window" className="map-window" value={win} onChange={setWin}
          options={WINDOWS.map(w => ({ value: w.value, label: w.label }))} />
        <ul>
          {list.map(p => {
            const c = priorityHex(p.priority, theme)
            return (
              <li key={p.id}>
                <button style={{ '--k': c } as CSSProperties} data-on={hovered === p.id || focus === p.id || undefined}
                  onPointerEnter={() => pointAt(p.id, c)} onPointerLeave={() => pointAt(null, null)}
                  onClick={() => setParams({ focus: p.id })}>
                  <i /><span><b>{p.title}</b><small>{p.number}, {p.building || p.location}</small></span>
                </button>
              </li>
            )
          })}
        </ul>
      </motion.aside>
    </main>
  )
}
