"""Who may see an incident, for code that works with plain documents (alerts, the live feed,
the notification list, the map). Mirrors the polymorphic User.can_view rules in models.py:

    admin       every incident
    technician  their own incidents, the unassigned queue, and anything still NEW/CLASSIFIED
    student     only the incidents they reported
"""
from app.domain.enums import Role, IncidentStatus as S

_QUEUE = {S.NEW.value, S.CLASSIFIED.value}


def can_view(user: dict, incident: dict) -> bool:
    if not user or not incident:
        return False
    role, uid = user.get('role'), str(user.get('id') or '')
    if role in (Role.ADMIN.value, Role.SYSTEM.value):
        return True
    if role == Role.TECHNICIAN.value:
        assigned = incident.get('assigned_to')
        return not assigned or str(assigned) == uid or incident.get('status') in _QUEUE
    return bool(uid) and str(incident.get('reporter_id') or '') == uid
