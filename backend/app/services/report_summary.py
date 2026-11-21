"""Time-window reports for every role (admin, technician, student).

    ReportWindow      value object: '1h' | '6h' | '1d' | '7d' | '30d' → start time and chart buckets
    build_summary()   the numbers, the chart series, the map pins and the table rows for one person

Who sees what follows app/domain/visibility.can_view:
    admin       every incident on campus, plus a per-technician table
    technician  their own work and the open queue, plus their personal numbers
    student     only what they reported, plus their personal numbers
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.domain.enums import OPEN_STATUSES, Role
from app.domain.exceptions import InvalidInputError
from app.domain.sla import parse_dt
from app.domain.visibility import can_view

CAMPUS_TZ = ZoneInfo('Asia/Kolkata')
DONE = ('RESOLVED', 'VERIFIED', 'CLOSED')
PHYSICAL = ('hostel', 'academics')          # an "offline place": someone has to walk there
PRIORITIES = ('P1', 'P2', 'P3', 'P4')


@dataclass(frozen=True)
class ReportWindow:
    key: str
    label: str
    span: timedelta
    bucket: timedelta

    WINDOWS = {}   # filled below

    @classmethod
    def of(cls, key: str) -> 'ReportWindow':
        w = cls.WINDOWS.get((key or '').lower())
        if not w:
            raise InvalidInputError(f"range must be one of {', '.join(cls.WINDOWS)}")
        return w

    def start(self, now: datetime) -> datetime:
        return now - self.span

    def buckets(self, now: datetime) -> list:
        """Bucket start times (campus time), oldest first, covering the whole window."""
        n = int(self.span / self.bucket)
        if self.bucket >= timedelta(days=1):
            end = now.astimezone(CAMPUS_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            step = int(self.bucket.total_seconds() // 60)
            local = now.astimezone(CAMPUS_TZ)
            end = local.replace(minute=(local.minute // step) * step if step < 60 else 0, second=0, microsecond=0)
        return [end - self.bucket * (n - 1 - i) for i in range(n)]


ReportWindow.WINDOWS.update({
    '1h': ReportWindow('1h', 'Last hour', timedelta(hours=1), timedelta(minutes=5)),
    '6h': ReportWindow('6h', 'Last 6 hours', timedelta(hours=6), timedelta(minutes=30)),
    '1d': ReportWindow('1d', 'Last 24 hours', timedelta(days=1), timedelta(hours=1)),
    '7d': ReportWindow('7d', 'Last 7 days', timedelta(days=7), timedelta(days=1)),
    '30d': ReportWindow('30d', 'Last 30 days (monthly)', timedelta(days=30), timedelta(days=1)),
})


def _building(loc: dict):
    return loc.get('hostel_name') or loc.get('academic_block')


def _minutes(a, b):
    return (b - a).total_seconds() / 60 if a and b else None


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs)) if xs else None


def _row(d: dict) -> dict:
    loc = d.get('location') or {}
    geo = d.get('geo') or {}
    res = d.get('resolution') or {}
    c_dt, r_dt = parse_dt(d.get('created_at')), parse_dt(res.get('resolved_at'))
    return {
        'id': str(d.get('_id') or d.get('id')), 'number': d.get('number'), 'title': d.get('title'),
        'status': d.get('status'), 'priority': d.get('priority'), 'category': d.get('category'),
        'service_name': d.get('service_name'), 'place_type': loc.get('type') or 'online',
        'building': _building(loc), 'room': loc.get('room_number'), 'location': loc.get('formatted'),
        'reporter_name': d.get('reporter_name'), 'assigned_name': d.get('assigned_name'),
        'sla_status': (d.get('sla') or {}).get('status'),
        'created_at': d.get('created_at'), 'resolved_at': res.get('resolved_at'),
        'resolution_minutes': round(_minutes(c_dt, r_dt)) if c_dt and r_dt else None,
        'lat': geo.get('lat'), 'lng': geo.get('lng'), 'geo_source': geo.get('source'),
    }


PROJECTION = {'number': 1, 'title': 1, 'status': 1, 'priority': 1, 'category': 1, 'service_name': 1,
              'location': 1, 'geo': 1, 'reporter_id': 1, 'reporter_name': 1, 'assigned_to': 1, 'assigned_name': 1,
              'sla': 1, 'created_at': 1, 'resolution': 1}


async def build_summary(container, user: dict, range_key: str, now: datetime | None = None) -> dict:
    window = ReportWindow.of(range_key)
    now = now or datetime.now(timezone.utc)
    start = window.start(now)
    all_docs = [d for d in await container.incidents.find({}, limit=20000, projection=PROJECTION) if can_view(user, d)]

    created = [d for d in all_docs if (parse_dt(d.get('created_at')) or start) > start]
    resolved = [d for d in all_docs if (parse_dt((d.get('resolution') or {}).get('resolved_at')) or start) > start]
    rows = sorted((_row(d) for d in created), key=lambda r: r['created_at'] or '', reverse=True)

    # chart: created vs resolved per bucket
    marks = window.buckets(now)
    def slot(dt):
        if not dt:
            return None
        local = dt.astimezone(CAMPUS_TZ)
        for i in range(len(marks) - 1, -1, -1):
            if local >= marks[i]:
                return i
        return None
    c_series, r_series = [0] * len(marks), [0] * len(marks)
    for d in created:
        i = slot(parse_dt(d.get('created_at')))
        if i is not None:
            c_series[i] += 1
    for d in resolved:
        i = slot(parse_dt((d.get('resolution') or {}).get('resolved_at')))
        if i is not None:
            r_series[i] += 1
    day_buckets = window.bucket >= timedelta(days=1)
    timeline = [{'at': m.isoformat(), 'label': m.strftime('%d %b' if day_buckets else '%H:%M'),
                 'created': c_series[i], 'resolved': r_series[i]} for i, m in enumerate(marks)]

    # map pins: reports at a physical place (hostel room or academic block) that have a location
    pins = [{**{k: r[k] for k in ('id', 'number', 'title', 'priority', 'status', 'service_name', 'category',
                                   'location', 'building', 'created_at', 'assigned_name', 'sla_status', 'lat', 'lng')},
             'source': r['geo_source']}
            for r in rows if r['place_type'] in PHYSICAL and r['lat'] is not None]
    by_b = defaultdict(list)
    for p in pins:
        if p['building']:
            by_b[p['building']].append(p)
    rank = {p: i for i, p in enumerate(PRIORITIES)}
    hotspots = sorted(({'building': b, 'count': len(v), 'open': sum(p['status'] in OPEN_STATUSES for p in v),
                        'worst_priority': min((p['priority'] for p in v if p['priority']), key=lambda x: rank.get(x, 9), default=None),
                        'breached': sum(p['sla_status'] == 'BREACHED' for p in v), 'is_hotspot': len(v) >= 3}
                       for b, v in by_b.items()), key=lambda h: -h['count'])

    st = Counter(r['status'] for r in rows)
    pr = Counter(r['priority'] or 'P4' for r in rows)
    out = {
        'range': window.key, 'label': window.label, 'from': start.isoformat(), 'to': now.isoformat(),
        'role': user.get('role'), 'scope': _scope_text(user),
        'totals': {
            'created': len(rows),
            'open': sum(st[s] for s in OPEN_STATUSES),
            'resolved_in_range': len(resolved),
            'breached': sum(r['sla_status'] == 'BREACHED' for r in rows),
            'p1': pr['P1'],
            'offline_place': sum(r['place_type'] in PHYSICAL for r in rows),
            'online': sum(r['place_type'] not in PHYSICAL for r in rows),
            'avg_resolution_minutes': _avg([r['resolution_minutes'] for r in rows]),
        },
        'by_status': [{'name': k, 'value': v} for k, v in st.most_common()],
        'by_priority': [{'name': p, 'value': pr[p]} for p in PRIORITIES],
        'by_category': [{'name': k or 'Other', 'value': v} for k, v in Counter(r['category'] for r in rows).most_common()],
        'by_service': [{'name': k or 'Unknown', 'value': v} for k, v in Counter(r['service_name'] for r in rows).most_common()],
        'by_building': [{'name': k, 'value': v} for k, v in
                        Counter(r['building'] for r in rows if r['place_type'] in PHYSICAL and r['building']).most_common()],
        'timeline': timeline,
        'map': {'points': pins, 'hotspots': hotspots, 'outages': [], 'days': max(1, window.span.days), 'threshold': 3},
        'rows': rows,
    }
    out['personal'] = await _personal(container, user, all_docs, created, resolved)
    return out


def _scope_text(user):
    return {Role.ADMIN.value: 'Every report on campus',
            Role.TECHNICIAN.value: 'Your assigned work and the open queue'}.get(user.get('role'), 'Reports you made')


async def _personal(container, user, all_docs, created, resolved) -> dict:
    role, uid = user.get('role'), str(user.get('id'))
    if role == Role.ADMIN.value:
        techs = await container.users.find({'role': Role.TECHNICIAN.value}, limit=500)
        table = []
        for t in techs:
            tid = str(t['_id'])
            mine_c = [d for d in created if str(d.get('assigned_to') or '') == tid]
            mine_r = [d for d in resolved if str((d.get('resolution') or {}).get('resolved_by') or d.get('assigned_to') or '') == tid]
            table.append({'name': t.get('name'), 'assigned': len(mine_c), 'resolved': len(mine_r),
                          'open_now': sum(1 for d in all_docs if str(d.get('assigned_to') or '') == tid and d.get('status') in OPEN_STATUSES),
                          'breached': sum((d.get('sla') or {}).get('status') == 'BREACHED' for d in mine_c),
                          'avg_resolution_minutes': _avg([_row(d)['resolution_minutes'] for d in mine_r])})
        reporters = Counter(d.get('reporter_name') or 'Unknown' for d in created).most_common(5)
        return {'kind': 'admin', 'technicians': sorted(table, key=lambda r: (-r['resolved'], -r['assigned'], r['name'] or '')),
                'top_reporters': [{'name': n, 'value': v} for n, v in reporters]}
    if role == Role.TECHNICIAN.value:
        mine = [d for d in created if str(d.get('assigned_to') or '') == uid]
        mine_r = [d for d in resolved if str(d.get('assigned_to') or '') == uid]
        return {'kind': 'technician', 'assigned': len(mine), 'resolved': len(mine_r),
                'open_now': sum(1 for d in all_docs if str(d.get('assigned_to') or '') == uid and d.get('status') in OPEN_STATUSES),
                'unassigned_queue': sum(1 for d in all_docs if not d.get('assigned_to') and d.get('status') in OPEN_STATUSES),
                'breached': sum((d.get('sla') or {}).get('status') == 'BREACHED' for d in mine),
                'site_visits': sum((d.get('location') or {}).get('type') in PHYSICAL for d in mine),
                'avg_resolution_minutes': _avg([_row(d)['resolution_minutes'] for d in mine_r])}
    return {'kind': 'student', 'reported': len(created),
            'open_now': sum(1 for d in all_docs if d.get('status') in OPEN_STATUSES),
            'resolved': sum(d.get('status') in DONE for d in created),
            'avg_resolution_minutes': _avg([_row(d)['resolution_minutes'] for d in created])}
