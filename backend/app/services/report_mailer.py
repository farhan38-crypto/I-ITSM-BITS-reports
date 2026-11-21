"""Emails reports: on demand from the Reports page, and on a schedule (the "report digest").

    ReportMailer.send_report()   build the person's report for a window, attach it as a file, email it
    ReportMailer.run_digests()   called every few minutes by the server; sends daily/weekly/monthly
                                 digests to everyone whose chosen hour has come

Every email is written to `email_logs` (shown under Account → Email → Recent emails). When SMTP is
not configured the email is only logged there ("logged, not sent"), so the feature still works in a demo.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.security import public_user
from app.domain.email_prefs import DIGEST_RANGE, EmailPreferences
from app.domain.exceptions import InvalidInputError
from app.services.report_export import ReportExporterFactory, TOTAL_LABELS
from app.services.report_summary import build_summary

log = logging.getLogger('report-mailer')
CAMPUS_TZ = ZoneInfo('Asia/Kolkata')
EMAIL_RX = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
MAX_RECIPIENTS = 10


def clean_recipients(raw) -> list:
    out = []
    for r in raw or []:
        r = str(r).strip().lower()
        if not r:
            continue
        if not EMAIL_RX.match(r) or len(r) > 254:
            raise InvalidInputError(f'"{r}" is not a valid email address')
        if r not in out:
            out.append(r)
    if not out:
        raise InvalidInputError('Add at least one email address')
    if len(out) > MAX_RECIPIENTS:
        raise InvalidInputError(f'You can send to at most {MAX_RECIPIENTS} addresses at once')
    return out


def report_body(s: dict, sender_name: str, message: str = '', digest: bool = False) -> str:
    lines = ['Hello,', '']
    if message:
        lines += [message.strip(), '']
    intro = (f'Here is your scheduled BITS reports summary ({s["label"].lower()}).' if digest else
             f'{sender_name} shared a BITS reports summary ({s["label"].lower()}) with you.')
    lines += [intro, f'Scope: {s["scope"]}', '']
    for k, v in s['totals'].items():
        lines.append(f'  {TOTAL_LABELS.get(k, k):<26} {"–" if v is None else v}')
    if s['by_building']:
        lines += ['', 'Busiest places: ' + ', '.join(f'{b["name"]} ({b["value"]})' for b in s['by_building'][:5])]
    urgent = [r for r in s['rows'] if r['priority'] in ('P1', 'P2') and r['status'] not in ('RESOLVED', 'VERIFIED', 'CLOSED')]
    if urgent:
        lines += ['', 'Urgent and still open:'] + [f'  {r["number"]}  {r["priority"]}  {r["title"]}' for r in urgent[:8]]
    lines += ['', 'The full report is attached.', '', 'BITS reports']
    return '\n'.join(lines)


class ReportMailer:
    def __init__(self, container):
        self.c = container

    @property
    def db(self):
        return self.c.users.db

    async def _deliver(self, sender_id, recipients, subject, body, attachment, kind):
        """Send one email per recipient (or just log it when SMTP is off). Returns 'sent', 'logged' or 'failed'."""
        configured = self.c.email_sender.is_configured()
        status = 'sent' if configured else 'logged'
        for to in recipients:
            entry = {'user_id': sender_id, 'recipient': to, 'subject': subject, 'body': body, 'kind': kind,
                     'attachment': attachment[0], 'channel': 'smtp' if configured else 'simulated_email',
                     'created_at': datetime.now(timezone.utc).isoformat()}
            if configured:
                try:
                    await self.c.email_sender.send(to, subject, body, attachments=[attachment])
                    entry['status'] = 'sent'
                except Exception as exc:
                    log.warning(f'Report email to {to} failed: {exc}')
                    entry.update(status='failed', error=str(exc)[:500])
                    status = 'failed'
            else:
                entry['status'] = 'logged'
            await self.db.email_logs.insert_one(entry)
        return status

    async def send_report(self, user: dict, range_key: str, fmt: str, recipients, message: str = '',
                          send_copy: bool = False) -> dict:
        to = clean_recipients(recipients)
        if send_copy and user.get('email') and user['email'].lower() not in to:
            to.append(user['email'].lower())
        exporter = ReportExporterFactory.get(fmt)
        s = await build_summary(self.c, user, range_key)
        stamp = datetime.now(CAMPUS_TZ).strftime('%Y%m%d-%H%M')
        attachment = (f"bits-reports-{s['role']}-{range_key}-{stamp}.{exporter.ext}", exporter.render(s), exporter.media_type)
        subject = f"BITS reports: {s['label']} ({s['totals']['created']} reports)"
        status = await self._deliver(user['id'], to, subject, report_body(s, user.get('name') or 'Someone', message or ''),
                                     attachment, 'report')
        return {'status': status, 'recipients': to, 'attachment': attachment[0],
                'note': None if status == 'sent' else
                'SMTP email is not set up, so the email was saved under Account → Email → Recent emails instead of being sent.'
                if status == 'logged' else 'Some emails could not be sent; see Account → Email → Recent emails.'}

    async def send_digest(self, user_doc: dict, now: datetime | None = None) -> dict:
        user = public_user(user_doc)
        prefs = EmailPreferences.of(user_doc).digest_view()
        freq = prefs['frequency'] if prefs['frequency'] != 'off' else 'daily'
        exporter = ReportExporterFactory.get(prefs['format'])
        s = await build_summary(self.c, user, DIGEST_RANGE[freq], now)
        stamp = datetime.now(CAMPUS_TZ).strftime('%Y%m%d')
        attachment = (f"bits-reports-{freq}-{stamp}.{exporter.ext}", exporter.render(s), exporter.media_type)
        subject = f"Your {freq} BITS reports summary: {s['totals']['created']} reports, {s['totals']['open']} open"
        status = await self._deliver(user['id'], [user_doc['email']], subject, report_body(s, user['name'], digest=True),
                                     attachment, 'digest')
        await self.db.users.update_one({'_id': user_doc['_id']},
                                       {'$set': {'email_digest.last_sent_at': datetime.now(timezone.utc).isoformat()}})
        return {'status': status, 'attachment': attachment[0]}

    @staticmethod
    def is_due(digest: dict, now: datetime) -> bool:
        freq = digest.get('frequency', 'off')
        if freq == 'off':
            return False
        local = now.astimezone(CAMPUS_TZ)
        if local.hour < int(digest.get('hour', 8)):
            return False
        last = digest.get('last_sent_at')
        last_local = datetime.fromisoformat(last).astimezone(CAMPUS_TZ) if last else None
        if freq == 'daily':
            return not last_local or last_local.date() < local.date()
        if freq == 'weekly':
            return local.weekday() == 0 and (not last_local or local - last_local > timedelta(days=6))
        return local.day == 1 and (not last_local or (last_local.year, last_local.month) != (local.year, local.month))

    async def run_digests(self, now: datetime | None = None) -> int:
        now = now or datetime.now(timezone.utc)
        sent = 0
        users = await self.db.users.find({'email_digest.frequency': {'$in': ['daily', 'weekly', 'monthly']},
                                          'is_active': {'$ne': False}, 'email': {'$ne': None}}).to_list(5000)
        for u in users:
            if u.get('email_notifications', True) is False or not self.is_due(u.get('email_digest') or {}, now):
                continue
            try:
                await self.send_digest(u, now)
                sent += 1
            except Exception as exc:
                log.warning(f'Digest for {u.get("email")} failed: {exc}')
        return sent
