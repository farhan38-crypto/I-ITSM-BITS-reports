// Account → Email: the master switch, one switch per kind of email (only the ones this role can
// get), a scheduled report summary by email (daily / weekly / monthly, hour, file type), and the
// last emails sent to you or by you. Security alerts are always sent.
import { useState } from 'react'
import { toast } from 'sonner'
import { Mail, MailCheck, MailWarning, Paperclip, Send } from 'lucide-react'
import { api, errorMessage, useQuery, type AccountOverview, type DigestFrequency, type EmailPrefs, type EmailPrefsUpdate, type ExportFormat, type SentEmail } from '../../api'
import { dateTime, timeAgo } from '../../lib/format'
import { Button, Field, Segmented, Select, Switch } from '../../ui/Controls'
import { Dialog } from '../../ui/Overlay'
import '../../styles/email-settings.css'

const FREQ: { value: DigestFrequency; label: string }[] = [
  { value: 'off', label: 'Off' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]
const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF' }, { value: 'xlsx', label: 'Excel (.xlsx)' }, { value: 'csv', label: 'CSV' }, { value: 'html', label: 'Web page (.html)' },
  { value: 'json', label: 'JSON' }, { value: 'md', label: 'Markdown' }, { value: 'txt', label: 'Plain text' }]
const hourLabel = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'am' : 'pm'}`
const WHEN: Record<DigestFrequency, string> = { off: '', daily: 'every day', weekly: 'every Monday', monthly: 'on the 1st of every month' }
const STATUS: Record<SentEmail['status'], string> = { sent: 'Sent', logged: 'Logged only', queued: 'Logged only', failed: 'Failed' }

export function EmailSettings({ a, onChange }: { a: AccountOverview; onChange: (p: EmailPrefs) => void }) {
  const p = a.preferences
  const [busy, setBusy] = useState(false)
  const emails = useQuery('account:emails', () => api.account.emails())
  const [open, setOpen] = useState<SentEmail | null>(null)

  const save = (body: EmailPrefsUpdate, msg?: string) =>
    api.account.updatePreferences(body).then(r => { onChange(r.preferences); if (msg) toast.success(msg) }).catch(e => toast.error(errorMessage(e)))
  const sendNow = async () => {
    setBusy(true)
    try {
      const r = await api.account.sendDigestNow()
      toast.success(r.status === 'sent' ? `Sent to ${a.user.email} with ${r.attachment}` : `Saved to Recent emails (${r.attachment}). Email sending isn't set up on the server.`)
      void emails.reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const d = p.digest

  return (
    <div className="email-settings">
      <Switch checked={p.email_notifications} label="Email me" hint="Turn every email off at once. Security alerts (new sign-ins, password changes) are always sent."
        onChange={v => save({ email_notifications: v }, v ? 'Emails on' : 'Emails off')} />

      <fieldset className="es-group" disabled={!p.email_notifications} data-off={!p.email_notifications || undefined}>
        <legend>What to email me about</legend>
        {p.topics.map(t => (
          <Switch key={t.key} checked={t.on && p.email_notifications} label={t.label} hint={t.hint}
            disabled={!p.email_notifications} onChange={v => save({ email_topics: { [t.key]: v } })} />
        ))}
      </fieldset>

      <fieldset className="es-group" disabled={!p.email_notifications} data-off={!p.email_notifications || undefined}>
        <legend>Report summary by email</legend>
        <p className="es-hint">{a.user.role === 'admin' ? 'Numbers for the whole campus' : a.user.role === 'technician' ? 'Your work and the open queue' : 'Your reports'}, with the full report attached.</p>
        <Segmented label="How often" value={d.frequency} onChange={v => save({ email_digest: { frequency: v } }, v === 'off' ? 'Report emails off' : `Report email ${WHEN[v]}`)} options={FREQ} />
        {d.frequency !== 'off' && (
          <div className="es-row">
            <Field label="At"><Select value={d.hour} onChange={e => save({ email_digest: { hour: Number(e.target.value) } })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</Select></Field>
            <Field label="Attach as"><Select value={d.format} onChange={e => save({ email_digest: { format: e.target.value as ExportFormat } })}>
              {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</Select></Field>
          </div>
        )}
        <div className="es-row es-foot">
          <small className="muted">{d.frequency === 'off' ? 'Off.' : `Next: ${WHEN[d.frequency]} at ${hourLabel(d.hour)} (campus time).`}
            {d.last_sent_at ? ` Last sent ${timeAgo(d.last_sent_at)}.` : ''}</small>
          <Button icon={<Send size={14} />} busy={busy} onClick={sendNow}>Send me one now</Button>
        </div>
      </fieldset>

      <div className="es-group">
        <div className="es-legend">Recent emails</div>
        {emails.data && !emails.data.smtp_configured && (
          <p className="es-note"><MailWarning size={15} /><span>Email sending isn't set up on the server yet, so emails are saved here instead of being delivered.
            An admin can add the SMTP settings to <code>backend/.env</code>.</span></p>
        )}
        {!emails.data ? <p className="muted small">Loading…</p> : !emails.data.emails.length ? <p className="muted small">No emails yet.</p> : (
          <ul className="es-list">
            {emails.data.emails.slice(0, 12).map(m => (
              <li key={m.id}>
                <button type="button" onClick={() => setOpen(m)}>
                  <span className="es-icon" data-status={m.status}>{m.status === 'sent' ? <MailCheck size={15} /> : <Mail size={15} />}</span>
                  <span className="es-main"><b>{m.subject}</b>
                    <small>{m.sent_by_me ? `To ${m.to}` : 'To you'}{m.attachment && <> · <Paperclip size={11} /> {m.attachment}</>}</small></span>
                  <span className="es-side"><em data-status={m.status}>{STATUS[m.status] || m.status}</em><time title={dateTime(m.created_at)}>{timeAgo(m.created_at)}</time></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.subject} description={open ? `To ${open.to} · ${dateTime(open.created_at)} · ${STATUS[open.status] || open.status}` : ''} size="md">
        {open && <>
          {open.attachment && <p className="es-attach"><Paperclip size={14} /> {open.attachment}</p>}
          {open.error && <p className="es-note"><MailWarning size={15} /><span>{open.error}</span></p>}
          <pre className="es-body">{open.body}</pre>
        </>}
      </Dialog>
    </div>
  )
}
