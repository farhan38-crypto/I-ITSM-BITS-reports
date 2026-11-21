// Reports for every account. What you see depends on who you are:
//   admin       every report on campus, a technician table and the busiest reporters
//   technician  your assigned work and the open queue, with your own numbers
//   student     the reports you made
// Pick a window (1 hr, 6 hr, 1 day, 7 days, monthly); reports at a physical place (hostel room or
// academic block) are pinned on the campus map, and the whole report downloads as a file.
import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Download, Mail, MapPin, X } from 'lucide-react'
import { api, errorMessage, invalidate, useQuery, type ExportFormat, type NameValue, type ReportRange, type ReportSummary } from '../../api'
import { useAuth } from '../../lib/auth'
import { dateTime, minutes, PRIORITY_LABEL, statusLabel } from '../../lib/format'
import { priorityHex } from '../../lib/themes'
import { Button, Empty, Field, Input, Segmented, Select, Skeleton, Switch, TextArea } from '../../ui/Controls'
import { Dialog } from '../../ui/Overlay'
import { PriorityBadge, StatusBadge } from '../../ui/Badges'
import { CampusMap, useBuildings, useMoveBuilding } from '../../components/map/CampusMap'
import '../../styles/reports.css'

const RANGES: { value: ReportRange; label: string }[] = [
  { value: '1h', label: '1 hr' }, { value: '6h', label: '6 hr' }, { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' }, { value: '30d', label: 'Monthly' },
]
const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF (.pdf)' }, { value: 'xlsx', label: 'Excel (.xlsx)' }, { value: 'csv', label: 'CSV (.csv)' },
  { value: 'json', label: 'JSON (.json)' }, { value: 'html', label: 'Web page (.html)' }, { value: 'md', label: 'Markdown (.md)' },
  { value: 'txt', label: 'Plain text (.txt)' },
]
const TITLE: Record<string, string> = { admin: 'Campus reports', technician: 'My work reports', customer: 'My reports summary' }

export default function ReportsPage() {
  const { user, theme } = useAuth()
  const [range, setRange] = useState<ReportRange>('1d')
  const [fmt, setFmt] = useState<ExportFormat>('pdf')
  const [busy, setBusy] = useState(false)
  const [mailing, setMailing] = useState(false)
  const { data, error } = useQuery<ReportSummary>(`reports:summary:${range}`, () => api.reports.summary(range), { pollMs: 60_000 })
  const { data: buildings } = useBuildings()
  const moveBuilding = useMoveBuilding()
  const admin = user?.role === 'admin'

  const download = async () => {
    setBusy(true)
    try {
      const url = await api.reports.exportUrl(range, fmt)
      const a = document.createElement('a')
      a.href = url; a.download = `bits-reports-${user?.role}-${range}.${fmt}`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const t = data?.totals
  return (
    <main className="page page-wide rp">
      <header className="page-head">
        <div><h1>{TITLE[user?.role || 'customer'] || 'Reports'}</h1><p>{data ? `${data.scope} · ${data.label}` : 'Loading…'}</p></div>
        <div className="rp-export">
          <Select aria-label="File type" value={fmt} onChange={e => setFmt(e.target.value as ExportFormat)}>
            {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</Select>
          <Button icon={<Mail size={15} />} onClick={() => setMailing(true)} disabled={!data}>Email</Button>
          <Button variant="primary" icon={<Download size={15} />} busy={busy} onClick={download} disabled={!data}>Export</Button>
        </div>
      </header>

      <Segmented label="Time window" value={range} onChange={setRange} options={RANGES} />
      <EmailReportDialog open={mailing} onClose={() => setMailing(false)} range={range} label={data?.label || ''} defaultFormat={fmt} />

      {error && !data ? <Empty title="Couldn't load the report">{errorMessage(error)}</Empty> : !data || !t ? <Skeleton h={420} r={20} /> : <>
        <section className="rp-kpis">
          <Kpi label="Reports created" value={t.created} />
          <Kpi label="Still open" value={t.open} />
          <Kpi label="Resolved in this window" value={t.resolved_in_range} />
          <Kpi label="SLA breached" value={t.breached} tone={t.breached ? priorityHex('P1', theme) : undefined} />
          <Kpi label="Critical (P1)" value={t.p1} tone={t.p1 ? priorityHex('P1', theme) : undefined} />
          <Kpi label="At a physical place" value={t.offline_place} hint={`${t.online} online`} />
          <Kpi label="Avg resolution" value={t.avg_resolution_minutes == null ? '–' : minutes(t.avg_resolution_minutes)} />
        </section>

        <Personal s={data} />

        <section className="rp-grid">
          <div className="surface pad rp-card rp-span2">
            <h2>Created vs resolved</h2>
            <Timeline s={data} created={priorityHex('P3', theme)} resolved="var(--b)" />
          </div>
          <div className="surface pad rp-card">
            <h2>By priority</h2>
            <Bars items={data.by_priority.map(p => ({ ...p, name: `${p.name} · ${PRIORITY_LABEL[p.name as 'P1'] || ''}` }))}
              colour={i => priorityHex(data.by_priority[i]!.name, theme)} />
          </div>
          <div className="surface pad rp-card"><h2>By status</h2><Bars items={data.by_status.map(s => ({ ...s, name: statusLabel(s.name) }))} /></div>
          <div className="surface pad rp-card"><h2>By category</h2><Bars items={data.by_category} /></div>
          <div className="surface pad rp-card"><h2>By building</h2><Bars items={data.by_building} empty="No reports at a physical place" /></div>
        </section>

        <section className="surface rp-map">
          <header className="pad rp-map-head">
            <h2><MapPin size={18} /> Where it happened <span className="label tabular">{data.map.points.length}</span></h2>
            <p>Reports at a hostel room or academic block in this window.{admin && ' Use the edit button on the map to drag a building; its reports move with it.'}</p>
          </header>
          <CampusMap data={data.map} buildings={buildings ?? null} className="map-embed rp-mapview" size="big" cooperative
            minimal={admin} onMoveBuilding={admin ? moveBuilding : undefined} />
        </section>

        <section className="surface rp-table">
          <h2 className="pad">Reports in this window <span className="label tabular">{data.rows.length}</span></h2>
          {!data.rows.length ? <Empty title="Nothing in this window">Try a longer window.</Empty> : (
            <div className="table-wrap">
              <table className="itable">
                <thead><tr><th>Incident</th><th>Title</th><th>Priority</th><th>Status</th><th>Where</th>
                  {user?.role !== 'customer' && <th>Reported by</th>}<th>Assigned</th><th>Created</th></tr></thead>
                <tbody>{data.rows.slice(0, 300).map(r => (
                  <tr key={r.id}>
                    <td><Link className="link tabular" to={`/incidents/${r.id}`}>{r.number}</Link></td>
                    <td>{r.title}</td>
                    <td><PriorityBadge p={r.priority} /></td>
                    <td><StatusBadge s={r.status} /></td>
                    <td className="small">{r.place_type === 'online' ? <span className="muted">Online{r.building ? `, ${r.building}` : ''}</span> : r.location || r.building}</td>
                    {user?.role !== 'customer' && <td className="small">{r.reporter_name}</td>}
                    <td className="small">{r.assigned_name || <span className="muted">Unassigned</span>}</td>
                    <td className="small">{dateTime(r.created_at)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </section>
      </>}
    </main>
  )
}

function Kpi({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: string }) {
  return (
    <motion.div className="surface rp-kpi" style={tone ? { '--k': tone } as CSSProperties : undefined} data-tone={tone ? '' : undefined}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <b className="tabular">{value}</b><span>{label}</span>{hint && <small>{hint}</small>}
    </motion.div>
  )
}

function Bars({ items, colour, empty = 'No data in this window' }: { items: NameValue[]; colour?: (i: number) => string; empty?: string }) {
  const max = Math.max(1, ...items.map(i => i.value))
  if (!items.some(i => i.value)) return <p className="muted small">{empty}</p>
  return (
    <ul className="rp-bars">
      {items.slice(0, 8).map((it, i) => (
        <li key={it.name} style={{ '--w': `${(it.value / max) * 100}%`, '--k': colour?.(i) || 'var(--a)' } as CSSProperties}>
          <span className="rp-bar-name">{it.name}</span><span className="rp-bar"><i /></span><b className="tabular">{it.value}</b>
        </li>
      ))}
    </ul>
  )
}

function Timeline({ s, created, resolved }: { s: ReportSummary; created: string; resolved: string }) {
  const pts = s.timeline
  const max = Math.max(1, ...pts.flatMap(p => [p.created, p.resolved]))
  const W = 100 / pts.length
  const every = Math.ceil(pts.length / 8)
  return (
    <div className="rp-timeline">
      <div className="rp-legend"><span style={{ '--k': created } as CSSProperties}><i />Created</span><span style={{ '--k': resolved } as CSSProperties}><i />Resolved</span></div>
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="Reports created and resolved over time">
        {pts.map((p, i) => (
          <g key={p.at}>
            <rect x={i * W + W * .14} width={W * .34} y={40 - (p.created / max) * 38} height={(p.created / max) * 38} rx=".6" fill={created}><title>{`${p.label}: ${p.created} created`}</title></rect>
            <rect x={i * W + W * .52} width={W * .34} y={40 - (p.resolved / max) * 38} height={(p.resolved / max) * 38} rx=".6" fill={resolved}><title>{`${p.label}: ${p.resolved} resolved`}</title></rect>
          </g>
        ))}
        <line x1="0" x2="100" y1="40" y2="40" stroke="currentColor" strokeOpacity=".2" strokeWidth=".3" />
      </svg>
      <div className="rp-axis">{pts.map((p, i) => <span key={p.at} style={{ width: `${W}%` }}>{i % every === 0 ? p.label : ''}</span>)}</div>
    </div>
  )
}

function Personal({ s }: { s: ReportSummary }) {
  const p = s.personal
  if (p.kind === 'student') return (
    <section className="surface pad rp-card rp-personal">
      <h2>Your reports</h2>
      <div className="rp-mini"><span><b>{p.reported}</b> reported in this window</span><span><b>{p.open_now}</b> open right now</span>
        <span><b>{p.resolved}</b> already fixed</span><span><b>{p.avg_resolution_minutes == null ? '–' : minutes(p.avg_resolution_minutes)}</b> average time to fix</span></div>
    </section>
  )
  if (p.kind === 'technician') return (
    <section className="surface pad rp-card rp-personal">
      <h2>Your work</h2>
      <div className="rp-mini"><span><b>{p.assigned}</b> assigned to you</span><span><b>{p.resolved}</b> you resolved</span>
        <span><b>{p.open_now}</b> open on your plate</span><span><b>{p.unassigned_queue}</b> waiting in the queue</span>
        <span><b>{p.site_visits}</b> need a site visit</span><span><b>{p.breached}</b> breached SLA</span>
        <span><b>{p.avg_resolution_minutes == null ? '–' : minutes(p.avg_resolution_minutes)}</b> your average fix time</span></div>
    </section>
  )
  return (
    <section className="rp-grid">
      <div className="surface rp-card rp-span2">
        <h2 className="pad">Technicians in this window</h2>
        {!p.technicians.length ? <p className="pad muted">No technicians yet.</p> : (
          <div className="table-wrap"><table className="itable">
            <thead><tr><th>Technician</th><th>Assigned</th><th>Resolved</th><th>Open now</th><th>SLA breached</th><th>Avg fix time</th></tr></thead>
            <tbody>{p.technicians.map(t => (
              <tr key={t.name}><td>{t.name}</td><td className="tabular">{t.assigned}</td><td className="tabular">{t.resolved}</td>
                <td className="tabular">{t.open_now}</td><td className="tabular">{t.breached}</td>
                <td>{t.avg_resolution_minutes == null ? '–' : minutes(t.avg_resolution_minutes)}</td></tr>))}</tbody>
          </table></div>
        )}
      </div>
      <div className="surface pad rp-card"><h2>Most reports from</h2><Bars items={p.top_reporters} /></div>
    </section>
  )
}

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Send this report (same window, chosen file type attached) to up to 10 people. */
function EmailReportDialog({ open, onClose, range, label, defaultFormat }: {
  open: boolean; onClose: () => void; range: ReportRange; label: string; defaultFormat: ExportFormat }) {
  const { user } = useAuth()
  const [to, setTo] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [format, setFormat] = useState<ExportFormat>(defaultFormat)
  const [message, setMessage] = useState('')
  const [copy, setCopy] = useState(true)
  const [busy, setBusy] = useState(false)
  // Typing a comma, space or Enter turns the address into a chip; pasting a list works too.
  const add = (text: string) => {
    const parts = text.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean)
    const bad = parts.filter(x => !EMAIL_RX.test(x))
    setTo(t => [...t, ...parts.filter(x => EMAIL_RX.test(x) && !t.includes(x))].slice(0, 10))
    setDraft(bad.join(' '))
    if (bad.length) toast.error(`Not an email address: ${bad.join(', ')}`)
  }
  const send = async () => {
    const all = draft.trim() ? [...to, ...draft.split(/[\s,;]+/).filter(x => EMAIL_RX.test(x))] : to
    if (!all.length) { toast.error('Add at least one email address'); return }
    setBusy(true)
    try {
      const r = await api.reports.email({ range, format, recipients: all, message: message.trim() || undefined, send_copy: copy })
      if (r.status === 'sent') toast.success(`Sent to ${r.recipients.length} ${r.recipients.length === 1 ? 'person' : 'people'} with ${r.attachment}`)
      else toast.warning(r.note || 'The email could not be sent.', { duration: 8000 })
      invalidate('account:emails')
      setTo([]); setDraft(''); setMessage(''); onClose()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const quick = [user?.email].filter(Boolean) as string[]
  return (
    <Dialog open={open} onClose={onClose} title="Email this report" description={`${label} · the report is attached as a file`} size="md"
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <Button variant="primary" icon={<Mail size={15} />} busy={busy} onClick={send} disabled={!to.length && !draft.trim()}>Send</Button></>}>
      <div className="form rp-mail">
        <Field label="To" hint="Up to 10 addresses. Press Enter or comma after each one.">
          <div className="rp-chips">
            {to.map(e => <span key={e} className="rp-chip">{e}<button type="button" aria-label={`Remove ${e}`} onClick={() => setTo(t => t.filter(x => x !== e))}><X size={12} /></button></span>)}
            <Input value={draft} placeholder={to.length ? 'Add another…' : 'name@pilani.bits-pilani.ac.in'} type="email" multiple
              onChange={e => { const v = e.target.value; if (/[,;\s]$/.test(v)) add(v); else setDraft(v) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(draft) } else if (e.key === 'Backspace' && !draft && to.length) setTo(t => t.slice(0, -1)) }}
              onBlur={() => draft.trim() && add(draft)}
              onPaste={e => { e.preventDefault(); add(draft + ' ' + e.clipboardData.getData('text')) }} />
          </div>
          {quick.filter(q => !to.includes(q)).length > 0 && !copy && (
            <div className="rp-quick">{quick.filter(q => !to.includes(q)).map(q => <button key={q} type="button" className="chip" onClick={() => setTo(t => [...t, q])}>+ {q}</button>)}</div>
          )}
        </Field>
        <Field label="Attach as"><Select value={format} onChange={e => setFormat(e.target.value as ExportFormat)}>
          {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</Select></Field>
        <Field label="Message" optional><TextArea rows={3} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Here are this week's numbers for the review meeting." /></Field>
        <Switch checked={copy} onChange={setCopy} label="Send me a copy" hint={user?.email || undefined} />
      </div>
    </Dialog>
  )
}
