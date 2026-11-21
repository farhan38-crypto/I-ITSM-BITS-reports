"""Which emails a person gets.

    EmailTopic        one switch on the Account page ("Technician on the way", "SLA alerts", ...)
                      covering one or more notification kinds, offered to some roles, on or off by default
    EmailPreferences  value object built from a user document: master switch + per-topic switches
                      + scheduled report email (digest)

Security alerts are not a topic: they are always sent.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.exceptions import InvalidInputError

ADMIN, TECH, STUDENT = 'admin', 'technician', 'customer'
ALL = (ADMIN, TECH, STUDENT)


@dataclass(frozen=True)
class EmailTopic:
    key: str
    label: str
    hint: str
    kinds: tuple
    roles: tuple = ALL
    default: bool = True


TOPICS = (
    EmailTopic('received', 'Report received', 'A confirmation with the incident number when you report something.',
               ('incident_created',), (STUDENT,), False),
    EmailTopic('assigned_me', 'Work assigned to me', 'A report was assigned to you.', ('assignment',), (TECH,)),
    EmailTopic('technician', 'Technician assigned', 'Who is handling your report.', ('technician_assigned',), (STUDENT,)),
    EmailTopic('info', 'More information needed', 'The technician needs details from you.', ('info_requested',), (STUDENT,)),
    EmailTopic('visit', 'Technician on the way / arrived', 'Site visits for hostel and classroom repairs.',
               ('en_route', 'arrived'), (STUDENT,)),
    EmailTopic('updates', 'Status changes and notes', 'Every status change, new note, priority change or attachment.',
               ('status_change', 'note', 'priority_changed', 'attachment'), ALL, False),
    EmailTopic('resolved', 'Resolved, closed or reopened', 'When a report is fixed, closed or reopened.',
               ('resolved', 'closed', 'reopened')),
    EmailTopic('sla', 'SLA alerts', 'A deadline is close or was missed.', ('sla_at_risk', 'sla_breached')),
    EmailTopic('escalation', 'Escalations and critical reports', 'Escalations, new P1 reports and possible outages.',
               ('escalation', 'critical', 'correlation'), (ADMIN, TECH)),
)
TOPIC_BY_KEY = {t.key: t for t in TOPICS}
TOPIC_BY_KIND = {k: t for t in TOPICS for k in t.kinds}
EMAIL_KINDS = frozenset(TOPIC_BY_KIND) | {'security'}

DIGEST_FREQUENCIES = ('off', 'daily', 'weekly', 'monthly')
DIGEST_FORMATS = ('pdf', 'xlsx', 'csv', 'html', 'json', 'md', 'txt')
DIGEST_RANGE = {'daily': '1d', 'weekly': '7d', 'monthly': '30d'}


def topics_for(role: str) -> list:
    return [t for t in TOPICS if role in t.roles]


@dataclass
class EmailPreferences:
    role: str
    enabled: bool = True
    topics: dict = field(default_factory=dict)          # topic key -> bool (only explicit choices)
    digest: dict = field(default_factory=dict)           # frequency, hour, format

    @classmethod
    def of(cls, user: dict) -> 'EmailPreferences':
        return cls(user.get('role') or STUDENT, user.get('email_notifications', True) is not False,
                   dict(user.get('email_topics') or {}), dict(user.get('email_digest') or {}))

    def wants(self, kind: str) -> bool:
        if kind == 'security':
            return True
        if not self.enabled:
            return False
        topic = TOPIC_BY_KIND.get(kind)
        if not topic:
            return True       # a kind with no switch follows the master switch
        return bool(self.topics.get(topic.key, topic.default))

    def digest_view(self) -> dict:
        d = self.digest
        return {'frequency': d.get('frequency', 'off'), 'hour': int(d.get('hour', 8)), 'format': d.get('format', 'pdf'),
                'last_sent_at': d.get('last_sent_at')}

    def view(self) -> dict:
        return {
            'email_notifications': self.enabled,
            'topics': [{'key': t.key, 'label': t.label, 'hint': t.hint, 'on': bool(self.topics.get(t.key, t.default))}
                       for t in topics_for(self.role)],
            'digest': self.digest_view(),
        }

    @staticmethod
    def validate_topics(role: str, topics: dict) -> dict:
        allowed = {t.key for t in topics_for(role)}
        bad = [k for k in topics if k not in allowed]
        if bad:
            raise InvalidInputError(f"Unknown email option: {', '.join(bad)}")
        return {k: bool(v) for k, v in topics.items()}

    @staticmethod
    def validate_digest(d: dict) -> dict:
        out = {}
        if 'frequency' in d and d['frequency'] is not None:
            if d['frequency'] not in DIGEST_FREQUENCIES:
                raise InvalidInputError(f"frequency must be one of {', '.join(DIGEST_FREQUENCIES)}")
            out['frequency'] = d['frequency']
        if 'hour' in d and d['hour'] is not None:
            h = int(d['hour'])
            if not 0 <= h <= 23:
                raise InvalidInputError('hour must be between 0 and 23')
            out['hour'] = h
        if 'format' in d and d['format'] is not None:
            if d['format'] not in DIGEST_FORMATS:
                raise InvalidInputError(f"format must be one of {', '.join(DIGEST_FORMATS)}")
            out['format'] = d['format']
        return out
