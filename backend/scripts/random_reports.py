"""Add a batch of RANDOM reports so every screen (Overview, Incidents, Map, Reports) has something to show.

    docker compose exec backend python scripts/random_reports.py                 adds 150 reports
    docker compose exec backend python scripts/random_reports.py --count 300     adds 300
    docker compose exec backend python scripts/random_reports.py --wipe --yes    deletes all reports first (backup saved)

    (without Docker:  cd backend && .venv/bin/python scripts/random_reports.py)

Every run is different: random student names, random issues, any category, any building, online or
at a physical place (hostel room / academic block). Reports are spread over the last 30 days with
extra weight on the last few hours, so the 1 hr / 6 hr / 1 day / 7 days / Monthly filters all have data.
Older reports are mostly fixed and closed; recent ones are new, assigned or being worked on.

Reports go through the real IncidentService (priority, SLA, audit trail, auto-assignment) with the
clock wound back, exactly like scripts/demo_data.py. Work is only ever assigned to technicians,
never to an admin or a student; a few demo technicians (electrician, carpenter, on-site tech) are
added so the on-site work has someone to go to. Physical-place reports use the building's pin (no GPS fix), so when
an admin drags a building on the map its reports move with it. No real emails are sent.
"""
import asyncio
import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_data as dd  # noqa: E402  (shares its clock, helpers, backup and wipe list)
from demo_data import db, init_db, container, hash_password, public_user, IncidentCreate, TransitionRequest  # noqa: E402
from app.domain.campus import HOSTELS, ACADEMIC_BLOCKS  # noqa: E402

FIRST = ['Aarav', 'Aditi', 'Akash', 'Ananya', 'Arjun', 'Bhavya', 'Chirag', 'Deepika', 'Dev', 'Diya', 'Farah', 'Gaurav',
         'Harini', 'Ishaan', 'Ishita', 'Jai', 'Kavya', 'Karan', 'Lakshmi', 'Manav', 'Meghna', 'Neel', 'Nikita', 'Om',
         'Pooja', 'Pranav', 'Rhea', 'Rahul', 'Saanvi', 'Sahil', 'Sana', 'Shreya', 'Siddharth', 'Tanvi', 'Tejas',
         'Uday', 'Vani', 'Varun', 'Yash', 'Zoya', 'Aditya', 'Nandini', 'Rohit', 'Simran', 'Vikram', 'Ayesha']
LAST = ['Agarwal', 'Bose', 'Chopra', 'Das', 'Deshmukh', 'Gupta', 'Iyer', 'Jain', 'Joshi', 'Kapoor', 'Khan', 'Kulkarni',
        'Menon', 'Mishra', 'Nair', 'Patel', 'Pillai', 'Rao', 'Reddy', 'Saxena', 'Shah', 'Sharma', 'Singh', 'Sinha',
        'Srinivasan', 'Thakur', 'Varma', 'Verma', 'Yadav', 'Banerjee', 'Ghosh', 'Hegde', 'Naidu', 'Qureshi']

# (title, description, category, service). {room} is filled in for physical places.
FACILITY = [  # need someone on site: hostel room or academic block
    ('Ceiling fan not working', 'The fan does not start at any speed. The regulator light is on.', 'Electrician Needed', 'Electrician Support'),
    ('Tube light flickering', 'The tube light keeps flickering and makes a buzzing sound.', 'Electrician Needed', 'Electrician Support'),
    ('Power socket dead', 'Neither socket near the table works; my laptop cannot charge.', 'Electrician Needed', 'Electrician Support'),
    ('Switchboard sparking', 'The switchboard sparked when I turned on the light. I have stopped using it.', 'Electrician Needed', 'Electrician Support'),
    ('AC not cooling', 'The AC runs but the room stays warm even after an hour.', 'Electrician Needed', 'Electrician Support'),
    ('Geyser not heating', 'Water stays cold; the geyser indicator light is off.', 'Electrician Needed', 'Electrician Support'),
    ('Door lock jammed', 'The key turns but the lock will not open from outside.', 'Carpenter Needed', 'Carpenter Support'),
    ('Cupboard door broken', 'One cupboard door came off its hinge and will not close.', 'Carpenter Needed', 'Carpenter Support'),
    ('Window latch broken', 'The window latch snapped and the window swings open at night.', 'Carpenter Needed', 'Carpenter Support'),
    ('Study table drawer stuck', 'The drawer is stuck shut; the runner seems bent.', 'Carpenter Needed', 'Carpenter Support'),
    ('Chair broken', 'The backrest of the chair has come loose and wobbles.', 'Carpenter Needed', 'Carpenter Support'),
    ('Bed frame creaking and loose', 'One leg of the bed frame is loose; the bed shifts when I sit.', 'Carpenter Needed', 'Carpenter Support'),
    ('LAN port not working', 'The wall LAN port gives no connection with two different cables.', 'Technician Needed', 'Technician Support'),
    ('Projector not turning on', 'The projector shows no image and the power light stays off.', 'Technician Needed', 'Technician Support'),
    ('Smart board not responding', 'The touch screen does not react and the PC input shows no signal.', 'Technician Needed', 'Technician Support'),
    ('Wi-Fi access point blinking red', 'The access point in the corridor is blinking red; no one nearby has internet.', 'Technician Needed', 'Technician Support'),
    ('Lab PC will not boot', 'The PC stops at a black screen after the BIOS logo.', 'Technician Needed', 'Technician Support'),
    ('Printer jammed', 'Paper jam in tray 2; nothing prints.', 'Technician Needed', 'Technician Support'),
]
REMOTE = [  # handled online
    ("Can't log in to the student portal", 'Sign-in fails with "invalid credentials" even after resetting the password.', 'Authentication', 'Identity Provider (SSO)'),
    ('SSO keeps asking for the password', 'Every page asks me to sign in again a few minutes after I log in.', 'Authentication', 'Identity Provider (SSO)'),
    ('Two-factor code not accepted', 'The authenticator code is rejected every time when signing in.', 'Authentication', 'Identity Provider (SSO)'),
    ('Fee payment failed but money deducted', 'The payment page timed out but the amount was debited from my account.', 'Application', 'Payment Gateway'),
    ('Payment page not loading', 'The fee payment page stays blank after choosing UPI.', 'Application', 'Payment Gateway'),
    ('Email not syncing on phone', 'My BITS email stopped syncing on my phone since yesterday.', 'Application', 'Email Service'),
    ('Mailbox full warning', 'I get a "mailbox full" error but I have deleted most of my mail.', 'Storage', 'Email Service'),
    ('VPN keeps disconnecting', 'The campus VPN disconnects every few minutes so I cannot reach the library journals.', 'Network', 'Corporate VPN'),
    ("Can't connect to VPN from home", 'The VPN client says "authentication failed" though my password works elsewhere.', 'Network', 'Corporate VPN'),
    ('Wi-Fi very slow in the evening', 'Pages take a minute to load between 8 and 11 pm.', 'Network', 'Office Wi-Fi'),
    ("Laptop won't connect to BITS-STUDENT", 'Wi-Fi asks for the password again and then fails to connect.', 'Network', 'Office Wi-Fi'),
    ('Cloud drive upload stuck', 'Uploading my project files to the cloud drive stays at 0%.', 'Storage', 'Cloud Storage'),
    ('Shared folder shows access denied', 'I cannot open the course folder my professor shared with me.', 'Security', 'Cloud Storage'),
    ('Suspicious phishing email received', 'I got an email asking for my BITS password from an unknown address.', 'Security', 'Email Service'),
    ('Course registration page error', 'Course registration shows "server error 500" when I submit.', 'Software', 'Customer Database'),
    ('Grade report not visible', 'My grade report page is empty though results are out for others.', 'Database', 'Customer Database'),
    ('HR portal not loading for TA payments', 'The HR portal page stays blank when I try to submit TA hours.', 'Software', 'HR Portal'),
    ('Software licence expired on lab account', 'MATLAB says the licence has expired when I log in.', 'Software', 'Technician Support'),
    ('Laptop running very slow after update', 'Since the last update my laptop takes ages to open anything.', 'Hardware', 'Technician Support'),
    ('Moodle quiz not submitting', 'The quiz says "submission failed" when I click finish.', 'Application', 'Customer Database'),
]
NOTES = [' Please help soon.', ' It started this morning.', ' Since last night.', ' Friends nearby have the same problem.',
         ' I have an evaluation tomorrow.', ' Already tried restarting.', '', '', '']
FIXES = {**dd.FIXES, 'Software': 'Reinstalled the application and cleared its cache; tested with the student.',
         'Database': 'Fixed the record and re-synced the student data.', 'Storage': 'Freed quota and retried the upload successfully.',
         'Security': 'Reset access, blocked the sender and confirmed the student is safe.', 'Cloud': 'Restarted the sync service.'}


def rand_age():
    """Minutes ago, weighted so every report filter (1h, 6h, 1d, 7d, 30d) has data."""
    bucket = random.choices(['1h', '6h', '1d', '7d', '30d'], weights=[8, 14, 22, 30, 26])[0]
    lo, hi = {'1h': (2, 58), '6h': (61, 359), '1d': (361, 1439), '7d': (1441, 7 * 1440), '30d': (7 * 1440 + 1, 29.5 * 1440)}[bucket]
    return random.uniform(lo, hi)


def rand_stage(age):
    """Older reports are mostly done; fresh ones are still moving."""
    if age < 60:
        return random.choices(['new', 'assigned', 'ack'], [5, 4, 1])[0]
    if age < 360:
        return random.choices(['new', 'assigned', 'ack', 'progress', 'resolved'], [2, 3, 2, 3, 2])[0]
    if age < 1440:
        return random.choices(['assigned', 'ack', 'progress', 'resolved', 'closed'], [2, 2, 3, 4, 2])[0]
    return random.choices(['assigned', 'progress', 'resolved', 'closed'], [1, 1, 2, 7])[0]


def room_for(building):
    if building in HOSTELS:
        return random.choice(['1', '2', '3']) + '%02d' % random.randrange(1, 45)
    if building.startswith('Block '):
        return f'{building[-1]}-{random.choice([1, 2, 3])}{random.randrange(1, 25):02d}'
    return random.choice(['Ground floor', '1st floor', '2nd floor', 'Hall 1', 'Room 104', 'Lab 2', 'Reception'])


def rand_plan():
    """(location_type, building, room, title, description, category, service, impact, urgency)."""
    if random.random() < .55:                                       # someone has to go there
        title, desc, cat, service = random.choice(FACILITY)
        building = random.choice(HOSTELS + ACADEMIC_BLOCKS)
        ltype = 'hostel' if building in HOSTELS else 'academics'
        room = room_for(building)
        title = f'{title} in {building.split(" (")[0]}' + (f', room {room}' if ltype == 'hostel' else f' ({room})')
    else:                                                           # handled online
        title, desc, cat, service = random.choice(REMOTE)
        ltype, building, room = 'online', None, None
    return ltype, building, room, title, desc + random.choice(NOTES), cat, service, \
        random.choices([1, 2, 3], [4, 5, 2])[0], random.choices([1, 2, 3], [3, 5, 3])[0]


async def make_students(n):
    out = []
    for _ in range(n):
        first, last = random.choice(FIRST), random.choice(LAST)
        sid = f'20{random.randint(21, 25)}{random.randint(1, 999):04d}'
        email = f'{first.lower()}.{last.lower()}.{sid[-4:]}.demo@example.com'
        await db.users.update_one({'email': email}, {
            '$setOnInsert': {'name': f'{first} {last}', 'email': email, 'skills': [], 'max_concurrent': 0, 'student_id': sid,
                             'phone': f'+91 9{random.randint(100000000, 999999999)}', 'is_active': True, 'created_at': dd.NOW,
                             'password_hash': hash_password('Student@1234')},
            '$set': {'role': 'customer'}}, upsert=True)
        out.append(public_user(await db.users.find_one({'email': email})))
    return out


DEMO_TECHS = [  # campus staff for the on-site work (password Tech@1234)
    ('Ramesh Yadav', ['Electrician Needed'], 'ramesh.yadav.demo@itsm.local'),
    ('Suresh Babu', ['Electrician Needed', 'Hardware'], 'suresh.babu.demo@itsm.local'),
    ('Mohan Lal', ['Carpenter Needed'], 'mohan.lal.demo@itsm.local'),
    ('Imran Shaikh', ['Technician Needed', 'Hardware', 'Network'], 'imran.shaikh.demo@itsm.local'),
    ('Kiran Kumar', ['Technician Needed', 'Network', 'Security'], 'kiran.kumar.demo@itsm.local'),
    ('Divya Menon', ['Authentication', 'Application', 'Software', 'Storage'], 'divya.menon.demo@itsm.local'),
]


async def ensure_technicians():
    for name, skills, email in DEMO_TECHS:
        await db.users.update_one({'email': email}, {
            '$setOnInsert': {'name': name, 'email': email, 'skills': skills, 'max_concurrent': 12, 'is_active': True,
                             'password_hash': hash_password('Tech@1234'), 'created_at': dd.NOW},
            '$set': {'role': 'technician'}}, upsert=True)
    return [public_user(t) for t in await db.users.find({'role': 'technician', 'is_active': {'$ne': False}}).to_list(None)]


async def assign_to_technician(svc, inc, admin, techs):
    """Auto-assign, but only ever to a technician account (never an admin or a student).
    If every technician is full the report simply stays in the unassigned queue."""
    tech_ids = {t['id'] for t in techs}
    try:
        inc = await svc.auto_assign(inc, admin)
    except Exception:
        pass
    if str(inc.get('assigned_to') or '') in tech_ids:
        return inc
    skilled = [t for t in techs if inc.get('category') in (t.get('skills') or [])]
    for tech in sorted(skilled, key=lambda _: random.random()) + sorted(techs, key=lambda _: random.random()):
        try:
            return await svc.assign(inc, tech['id'], admin)
        except Exception:       # that technician is at their limit; try the next one
            continue
    return inc


async def build(count):
    svc = container.incident_service
    container.dispatcher.channels = [c for c in container.dispatcher.channels if not isinstance(c, dd.SmtpEmailChannel)]
    dd.install_clock()
    services = {s['name']: str(s['_id']) for s in await db.services.find({}).to_list(None)}
    admin = public_user(await db.users.find_one({'role': 'admin'}))
    techs = await ensure_technicians()
    if not techs:
        sys.exit('No technician accounts found. Add one under People first (reports are only assigned to technicians).')
    students = await make_students(max(12, count // 6))
    order = ['new', 'assigned', 'ack', 'progress', 'resolved', 'closed']

    plans = sorted(((rand_age(),) + rand_plan() for _ in range(count)), key=lambda p: -p[0])   # oldest first
    made, skipped = [], 0
    for age, ltype, building, room, title, desc, cat, service, impact, urgency in plans:
        if service not in services:
            skipped += 1
            continue
        reporter = random.choice(students)
        stage = rand_stage(age)
        dd.at(age)
        try:
            inc = await svc.create(IncidentCreate(
                title=title, description=desc, category=cat, service_id=services[service], impact=impact, urgency=urgency,
                affected_users=random.choice([1, 1, 1, 2, 5, 20]), location_type=ltype,
                hostel_name=building if ltype == 'hostel' else None,
                academic_block=building if ltype == 'academics' else None, room_number=room,
                phone=reporter.get('phone'), acknowledge_duplicate=True, confirm_in_scope=True), reporter)
        except Exception as exc:
            print(f'  skipped "{title}": {exc}')
            skipped += 1
            continue
        reached = order.index(stage)
        elapsed = [0.0]

        def later(minutes):
            elapsed[0] = min(elapsed[0] + minutes, age - 0.2)
            dd.at(age - elapsed[0])

        quick = lambda lo, hi: min(random.uniform(lo, hi), age * 0.15)  # noqa: E731
        try:
            if reached >= 1:
                later(quick(2, 10))
                inc = await assign_to_technician(svc, await svc.get(dd.iid(inc)), admin, techs)
                if not inc.get('assigned_to'):
                    raise RuntimeError('every technician is at their limit, left in the queue')
                tech = await dd.user_by_id(inc['assigned_to'])
                if reached >= 2:
                    later(quick(2, 12))
                    inc = await svc.transition(dd.iid(inc), TransitionRequest(target_status='ACKNOWLEDGED'), tech)
                if reached >= 3:
                    later(quick(3, 20))
                    inc = await svc.transition(dd.iid(inc), TransitionRequest(target_status='IN_PROGRESS'), tech)
                if reached >= 4:
                    target = dd.RESOLVE_WITHIN.get(inc.get('priority'), 480)
                    share = random.uniform(1.1, 1.8) if random.random() < .15 else random.uniform(.25, .9)
                    later(max(target * share - elapsed[0], 5))
                    extra = {'resolution_summary': FIXES.get(cat, 'Fixed and tested.')}
                    if ltype == 'hostel':
                        code = await db.handover_codes.find_one({'incident_id': dd.iid(inc)})
                        extra['handover_code'] = code['code'] if code else None
                    inc = await svc.transition(dd.iid(inc), TransitionRequest(target_status='RESOLVED', **extra), tech)
                if reached >= 5:
                    later(random.uniform(20, 300))
                    try:
                        inc = await svc.transition(dd.iid(inc), TransitionRequest(
                            target_status='VERIFIED', feedback_rating=random.choice([3, 4, 5, 5]),
                            feedback_comment=random.choice(['Quick fix, thanks!', 'Works now.', 'Took a while but sorted.'])),
                            await dd.user_by_id(inc['reporter_id']))
                    except Exception:
                        inc = await svc.transition(dd.iid(inc), TransitionRequest(target_status='VERIFIED'), admin)
                    later(random.uniform(5, 90))
                    inc = await svc.transition(dd.iid(inc), TransitionRequest(target_status='CLOSED'), admin)
        except Exception as exc:     # a rule blocked a later step; the report stays where it got to
            print(f'  {inc.get("number")} stopped early: {exc}')
        made.append(inc)
    dd._clock[0] = dd.datetime.now(dd.timezone.utc)
    return made, skipped


async def main():
    count = int(sys.argv[sys.argv.index('--count') + 1]) if '--count' in sys.argv else 150
    await init_db()
    print(f"Database '{db.name}': {await db.incidents.count_documents({})} incidents now.")
    if '--wipe' in sys.argv:
        if '--yes' not in sys.argv and input('Delete ALL reports first? A backup is saved. Type "yes": ').strip().lower() != 'yes':
            print('Nothing changed.')
            return
        path, counts = await dd.backup()
        print(f'Backup saved: {path}  ({counts})')
        for name in dd.WIPE:
            await db[name].delete_many({})
        await db.counters.update_one({'_id': 'incident'}, {'$set': {'value': 0}}, upsert=True)
    made, skipped = await build(count)
    tally = lambda key: dict(sorted(Counter(str(key(i)) for i in made).items()))  # noqa: E731
    print(f'Added {len(made)} random reports ({skipped} skipped).')
    print('  status:  ', tally(lambda i: i.get('status')))
    print('  priority:', tally(lambda i: i.get('priority')))
    print('  place:   ', tally(lambda i: (i.get('location') or {}).get('type')))
    print('Students use password Student@1234 (emails end in .demo@example.com); demo technicians use Tech@1234.')


if __name__ == '__main__':
    asyncio.run(main())
