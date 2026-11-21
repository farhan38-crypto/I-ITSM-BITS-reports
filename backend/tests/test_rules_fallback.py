"""The rules that run when Gemini is unavailable (no key, quota used up, timeout)."""
import pytest

from app.domain.campus import extract_location
from app.domain.scope import RuleBasedScopeClassifier, ScopeKind


@pytest.mark.parametrize('text,block,room', [
    ('Projector in F102 is not turning on', 'Block F', 'F-102'),
    ('D-204 lab PCs have no internet', 'Block D', 'D-204'),
    ('mic in LTC 101 is dead', 'LTC (Lecture Theatre Complex)', None),
])
def test_room_codes_also_name_the_block(text, block, room):
    loc = extract_location(text)
    assert (loc['type'], loc['academic_block'], loc['room_number']) == ('academics', block, room)


def test_years_and_articles_are_not_rooms():
    assert extract_location('a 2024 update broke the portal')['room_number'] is None


@pytest.mark.parametrize('text,kind', [
    ('My roommate stole my charger', ScopeKind.SECURITY),
    ('someone is stealing from our wing', ScopeKind.SECURITY),
    ('someone stole my password', ScopeKind.IT),
    ('her demo stole the show, but the projector died', ScopeKind.IT),
])
def test_theft_goes_to_security_but_cyber_and_idioms_do_not(text, kind):
    assert RuleBasedScopeClassifier().assess('', text).kind == kind
