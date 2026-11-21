"""BITS Pilani Hyderabad campus reference data, plus rules that read a
location and a business-criticality hint out of free text. Used to autofill
the report form from the student's (or the AI's) description."""
import re

HOSTELS = ['Vishwakarma Bhavan', 'Valmiki Bhavan', 'Gautam Bhavan', 'Gandhi Bhavan', 'Ram Bhavan', 'Vyas Bhavan',
           'Shankar Bhavan', 'Krishna Bhavan', 'Meera Bhavan', 'Malviya Bhavan', 'Ganga Bhavan']
ACADEMIC_BLOCKS = ['Block A', 'Block B', 'Block C', 'Block D', 'Block F', 'Block G', 'NAB (New Academic Block)',
                   'LTC (Lecture Theatre Complex)', 'Library', 'Workshop', 'SAC (Student Activity Centre)', 'Medical Centre']

ALL_BUILDINGS = HOSTELS + ACADEMIC_BLOCKS


def building_kind(name: str) -> str:
    """'hostel' or 'academic' (shown on the map and used to pick the form's place type)."""
    return 'hostel' if name in HOSTELS else 'academic'


def match_building(text) -> 'str | None':
    """The exact campus name for a building as Gemini or a person wrote it ('Valmiki', 'D block', 'LTC'),
    or None when it isn't one of ours. Never invents a building."""
    t = re.sub(r'\s+', ' ', str(text or '')).strip().lower()
    if not t or t in ('null', 'none', 'n/a', 'unknown'):
        return None
    for name in ALL_BUILDINGS:
        if t == name.lower() or t == name.split(' (')[0].lower():
            return name
    loc = extract_location(t if re.search(r'bhavan|bhawan|hostel|block|blk', t) else f'{t} bhavan')
    if loc['hostel_name'] in HOSTELS:
        return loc['hostel_name']
    loc = extract_location(t)
    return loc['academic_block'] if loc['academic_block'] in ACADEMIC_BLOCKS else None


_HOSTEL_RX = re.compile(r'\b(vishwakarma|valmiki|gautam|gandhi|ram|vyas|shankar|krishna|meera|mira|malviya|malaviya|ganga)'
                        r'\s*(?:bhavan|bhawan|hostel)\b')
_HOSTEL_ALIAS = {'mira': 'meera', 'malaviya': 'malviya'}   # other spellings students use
_BLOCK_RX = [
    (re.compile(r'\b(?:block|blk)\s*-?\s*([abcdfg])\b'), lambda m: f'Block {m.group(1).upper()}'),
    (re.compile(r'\b([abcdfg])\s*-?\s*block\b'), lambda m: f'Block {m.group(1).upper()}'),
    (re.compile(r'\b(?:nab|new academic block)\b'), lambda m: 'NAB (New Academic Block)'),
    (re.compile(r'\b(?:ltc|lecture theat(?:re|er) complex)\b'), lambda m: 'LTC (Lecture Theatre Complex)'),
    (re.compile(r'\blibrary\b'), lambda m: 'Library'),
    (re.compile(r'\bworkshop\b'), lambda m: 'Workshop'),
    (re.compile(r'\b(?:sac|student activity cent(?:re|er))\b'), lambda m: 'SAC (Student Activity Centre)'),
    (re.compile(r'\bmedical cent(?:re|er)\b'), lambda m: 'Medical Centre'),
]
_ROOM_RX = [
    re.compile(r'\b(ltc|nab|[abcdfg])(?:\s*-\s*|)(\d{3,4})\b'),                               # LTC-101, D-204, F102
    re.compile(r'\b(?:room|rm|r\.?\s?no\.?|lab|hall|classroom)\s*(?:no\.?|number|#)?\s*:?\s*([a-z]?-?\d{2,4}[a-z]?)\b'),
]

CRITICAL_WORDS = re.compile(r'\b(?:exams?|quiz(?:zes)?|mid ?sems?|compre(?:hensive)?s?|viva|deadline|due (?:today|tonight|in)|'
                            r'placement|interview|fee payment|payment|registration closes|results?)\b')
IMPORTANT_WORDS = re.compile(r'\b(?:assignments?|labs?|class(?:es)?|lectures?|projects?|coursework|research|thesis|'
                             r'presentation|online class|meeting|submission|study|studies)\b')


def extract_location(text: str) -> dict:
    """{'type': 'hostel'|'academics'|None, 'hostel_name', 'academic_block', 'room_number'} from free text."""
    t = (text or '').lower()
    out = {'type': None, 'hostel_name': None, 'academic_block': None, 'room_number': None}
    m = _HOSTEL_RX.search(t)
    if m:
        out['hostel_name'] = f'{_HOSTEL_ALIAS.get(m.group(1), m.group(1)).capitalize()} Bhavan'
        out['type'] = 'hostel'
    else:
        for rx, name in _BLOCK_RX:
            m = rx.search(t)
            if m:
                out['academic_block'] = name(m)
                out['type'] = 'academics'
                break
    m = _ROOM_RX[0].search(t)
    if m:
        out['room_number'] = f'{m.group(1).upper()}-{m.group(2)}'
        if not out['type']:   # "F102" also says which block
            out['type'] = 'academics'
            out['academic_block'] = {'ltc': 'LTC (Lecture Theatre Complex)', 'nab': 'NAB (New Academic Block)'}.get(m.group(1), f'Block {m.group(1).upper()}')
    else:
        m = _ROOM_RX[1].search(t)
        if m:
            out['room_number'] = m.group(1).upper()
    return out


def estimate_criticality(text: str) -> int:
    """1 = inconvenience, 2 = blocks coursework/work, 3 = exams, payments, deadlines."""
    t = (text or '').lower()
    if CRITICAL_WORDS.search(t):
        return 3
    if IMPORTANT_WORDS.search(t):
        return 2
    return 1
