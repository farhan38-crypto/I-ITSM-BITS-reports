"""Unit tests for the pure domain layer: priority strategies, assignment and the state machine."""
import pytest

from app.domain.enums import IncidentStatus, Priority, Role
from app.domain.exceptions import (
    InvalidInputError, InvalidStateTransitionError, TechnicianUnavailableError, UnauthorizedOperationError,
)
from app.domain.state import StateFactory
from app.domain.strategies import (
    LoadBalancedStrategy, MatrixPriorityStrategy, PriorityInput, SkillBasedStrategy,
    SmartRecommendationStrategy, TechnicianProfile, WeightedScorePriorityStrategy,
)


# ---- priority ----

def test_priority_boundaries():
    weighted = WeightedScorePriorityStrategy()
    assert weighted.calculate(PriorityInput(3, 3, 2, 1)).priority == Priority.P1
    assert weighted.calculate(PriorityInput(1, 1, 1, 1)).priority == Priority.P4


def test_invalid_priority():
    with pytest.raises(InvalidInputError):
        PriorityInput(0, 2, 1, 1)


def test_matrix_priority_p1():
    assert MatrixPriorityStrategy().calculate(PriorityInput(3, 3)).priority == Priority.P1


def test_matrix_priority_p2():
    assert MatrixPriorityStrategy().calculate(PriorityInput(2, 3)).priority == Priority.P2


def test_matrix_priority_p3():
    assert MatrixPriorityStrategy().calculate(PriorityInput(1, 3)).priority == Priority.P3


def test_matrix_priority_p4():
    assert MatrixPriorityStrategy().calculate(PriorityInput(1, 1)).priority == Priority.P4


# ---- assignment ----

def test_assignment():
    tech = TechnicianProfile('1', 'A', ['Network'])
    assert SkillBasedStrategy().select({'category': 'Network', 'priority': 'P3'}, [tech]).id == '1'


def test_capacity_rejects_non_p1():
    full = TechnicianProfile('1', 'A', ['Network'], open_count=5, max_concurrent=5)
    with pytest.raises(TechnicianUnavailableError):
        LoadBalancedStrategy().select({'category': 'Network', 'priority': 'P3'}, [full])


def test_p1_capacity_override():
    full = TechnicianProfile('1', 'A', ['Network'], open_count=5, max_concurrent=5)
    assert LoadBalancedStrategy().select({'category': 'Network', 'priority': 'P1'}, [full]).id == '1'


def test_smart_has_breakdown():
    tech = TechnicianProfile('1', 'A', ['Database'])
    ranked = SmartRecommendationStrategy().rank({'category': 'Database'}, [tech])[0]
    assert set(ranked.breakdown) == {'skill', 'load', 'experience', 'service', 'speed'}


# ---- lifecycle (State pattern) ----

def test_state():
    with pytest.raises(InvalidStateTransitionError):
        StateFactory.get(IncidentStatus.NEW).transition(IncidentStatus.CLOSED, Role.ADMIN)


def test_closed_terminal():
    assert StateFactory.get(IncidentStatus.CLOSED).is_terminal()


def test_customer_can_verify():
    state = StateFactory.get(IncidentStatus.RESOLVED).transition(IncidentStatus.VERIFIED, Role.CUSTOMER)
    assert state.name == IncidentStatus.VERIFIED


def test_technician_cannot_verify():
    with pytest.raises(UnauthorizedOperationError):
        StateFactory.get(IncidentStatus.RESOLVED).transition(IncidentStatus.VERIFIED, Role.TECHNICIAN)


def test_pending_info_customer_resume():
    state = StateFactory.get(IncidentStatus.PENDING_INFO).transition(IncidentStatus.IN_PROGRESS, Role.CUSTOMER)
    assert state.name == IncidentStatus.IN_PROGRESS
