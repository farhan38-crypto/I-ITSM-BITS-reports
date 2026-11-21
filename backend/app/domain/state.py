"""State pattern for the incident lifecycle.

Each lifecycle status is its own class. A state knows which statuses it may move to
and which roles may make each move, so an illegal transition (for example NEW -> CLOSED)
can never happen: it raises InvalidStateTransitionError, and a legal move by the wrong
role raises UnauthorizedOperationError.
"""
from app.domain.enums import IncidentStatus as S, Role as R
from app.domain.exceptions import InvalidStateTransitionError, UnauthorizedOperationError


class IncidentState:
    """Base class: one subclass per status. `transitions` maps target status -> allowed roles."""
    name = None
    transitions = {}

    def is_terminal(self):
        return not self.transitions

    def allowed_targets(self, role):
        return [target for target, roles in self.transitions.items() if role in roles]

    def transition(self, target, role):
        if target not in self.transitions:
            raise InvalidStateTransitionError(f"Illegal transition {self.name.value} -> {target.value}")
        if role not in self.transitions[target]:
            raise UnauthorizedOperationError(f"Role '{role.value}' may not perform this transition")
        return StateFactory.get(target)


class NewState(IncidentState):
    name = S.NEW
    transitions = {S.CLASSIFIED: {R.SYSTEM, R.ADMIN, R.TECHNICIAN}}


class ClassifiedState(IncidentState):
    name = S.CLASSIFIED
    transitions = {S.ASSIGNED: {R.SYSTEM, R.ADMIN, R.TECHNICIAN}}


class AssignedState(IncidentState):
    name = S.ASSIGNED
    transitions = {S.ACKNOWLEDGED: {R.TECHNICIAN, R.ADMIN}}


class AcknowledgedState(IncidentState):
    name = S.ACKNOWLEDGED
    transitions = {S.IN_PROGRESS: {R.TECHNICIAN, R.ADMIN}}


class InProgressState(IncidentState):
    name = S.IN_PROGRESS
    transitions = {
        S.PENDING_INFO: {R.TECHNICIAN, R.ADMIN},
        S.RESOLVED: {R.TECHNICIAN, R.ADMIN},
    }


class PendingInfoState(IncidentState):
    name = S.PENDING_INFO
    transitions = {S.IN_PROGRESS: {R.CUSTOMER, R.TECHNICIAN, R.ADMIN}}


class ResolvedState(IncidentState):
    name = S.RESOLVED
    transitions = {
        S.VERIFIED: {R.CUSTOMER, R.ADMIN},
        S.IN_PROGRESS: {R.CUSTOMER, R.ADMIN},   # reopen
    }


class VerifiedState(IncidentState):
    name = S.VERIFIED
    transitions = {S.CLOSED: {R.CUSTOMER, R.ADMIN, R.TECHNICIAN, R.SYSTEM}}


class ClosedState(IncidentState):
    name = S.CLOSED
    transitions = {}


class StateFactory:
    """Returns the shared state object for a status (states hold no per-incident data)."""
    _registry = {state.name: state() for state in (
        NewState, ClassifiedState, AssignedState, AcknowledgedState, InProgressState,
        PendingInfoState, ResolvedState, VerifiedState, ClosedState,
    )}

    @classmethod
    def get(cls, status):
        return cls._registry[S(status)]
