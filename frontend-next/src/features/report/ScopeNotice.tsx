// What to do when a report isn't an IT or room-repair problem (a medical emergency, fire, theft,
// a snake...). The backend's scope check decides; this shows its guidance twice:
//   - a popup in the middle of the screen the first time each kind is detected, so nobody keeps
//     typing a report while they should be calling someone;
//   - the same guidance inline under the description, which stays after the popup is closed.
// Both offer "It's an IT or room-repair problem, continue" for false alarms.
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { AlertOctagon, Bug, Check, Flame, HeartHandshake, Info, Phone, ShieldAlert, Siren, Zap, type LucideIcon } from 'lucide-react'
import type { ScopeAssessment } from '../../api'
import { Button } from '../../ui/Controls'
import { Dialog } from '../../ui/Overlay'

const ICON: Record<string, LucideIcon> = {
  medical_emergency: Siren, fire: Flame, electrical_emergency: Zap, mental_health_crisis: HeartHandshake,
  security: ShieldAlert, pest_animal: Bug, other_non_it: Info,
}
/** danger: act now · care: reach out (calm, not alarming) · info: wrong place for this report */
const tone = (s: ScopeAssessment) => s.kind === 'mental_health_crisis' ? 'care' : s.emergency ? 'danger' : 'info'
const tel = (n: string) => `tel:${n.replace(/\s/g, '')}`

function Contacts({ scope, big }: { scope: ScopeAssessment; big?: boolean }) {
  if (!scope.contacts.length) return null
  return (
    <div className={`contacts ${big ? 'contacts-big' : ''}`}>
      {scope.contacts.map((c, i) => (
        <a key={c.number} href={tel(c.number)} className="contact" data-first={i === 0 || undefined}>
          <span className="contact-ic"><Phone size={big ? 16 : 14} /></span>
          <span><b>{c.number}</b><small>{c.label}{c.note ? ` · ${c.note}` : ''}</small></span>
        </a>
      ))}
    </div>
  )
}

export function ScopeAlert({ scope, ok, onOk }: { scope: ScopeAssessment; ok: boolean; onOk: () => void }) {
  const Icon = ICON[scope.kind] || AlertOctagon
  return (
    <motion.div className="alert scope-alert" data-tone={tone(scope)} role="alert"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>
      <Icon size={20} />
      <div>
        <b>{scope.title}</b>
        <p>{scope.message}</p>
        <Contacts scope={scope} />
        {!ok ? <button type="button" className="link small" onClick={onOk}>It’s an IT or room-repair problem, continue</button>
          : <p className="small ok-line"><Check size={13} /> OK, continuing with the report.</p>}
      </div>
    </motion.div>
  )
}

/** Pops up once per kind of problem (typing more of the same sentence doesn't bring it back). */
export function ScopePopup({ scope, ok, onOk }: { scope: ScopeAssessment | null; ok: boolean; onOk: () => void }) {
  const [seen, setSeen] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (scope && !ok && scope.kind !== seen) { setSeen(scope.kind); setOpen(true) }
    if (!scope) setOpen(false)
  }, [scope, ok, seen])
  if (!scope) return null
  const Icon = ICON[scope.kind] || AlertOctagon
  const t = tone(scope)
  return (
    <Dialog open={open} onClose={() => setOpen(false)} size="md" className="scope-pop" footer={<>
      <Button variant="ghost" className="sm" onClick={() => { onOk(); setOpen(false) }}>It’s an IT or room-repair problem</Button>
      <Button variant={t === 'danger' ? 'danger' : 'primary'} data-autofocus onClick={() => setOpen(false)}>{t === 'info' ? 'OK' : 'Close'}</Button>
    </>}>
      <div className="scope-pop-body" data-tone={t}>
        <motion.span className="scope-pop-ic" initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18, delay: .05 }}>
          <Icon size={30} />
        </motion.span>
        <h2>{scope.title}</h2>
        <p>{scope.message}</p>
        <Contacts scope={scope} big />
        {t !== 'info' && <p className="scope-pop-note">Tap a number to call. On a computer, dial it from your phone.</p>}
      </div>
    </Dialog>
  )
}
