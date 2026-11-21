"""Nobody hears about, or sees, an incident they cannot open (regression: a technician got
escalation alerts for someone else's assigned incident and hit "access denied")."""
import time
from datetime import timedelta

import pytest

from app.core.container import container
from app.domain.sla import parse_dt
from app.domain.visibility import can_view
from tests.test_features import client, login, report, service_id, notifications_for


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module", autouse=True)
async def setup_db(anyio_backend):
    from app.core.db import init_db
    await init_db()
    yield


def test_visibility_rule_matches_roles():
    inc = {'status': 'ASSIGNED', 'reporter_id': 'r1', 'assigned_to': 't1'}
    assert can_view({'role': 'admin', 'id': 'a'}, inc)
    assert can_view({'role': 'technician', 'id': 't1'}, inc)
    assert not can_view({'role': 'technician', 'id': 't2'}, inc)
    assert can_view({'role': 'technician', 'id': 't2'}, {**inc, 'assigned_to': None})
    assert can_view({'role': 'customer', 'id': 'r1'}, inc)
    assert not can_view({'role': 'customer', 'id': 'r2'}, inc)
    assert not can_view({'role': 'customer', 'id': 'r1'}, None)


@pytest.mark.anyio
async def test_escalation_of_an_assigned_incident_only_reaches_people_who_can_open_it():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        inc = await report(ac, cust, await service_id(ac, cust, "Payment Gateway"), "Application", 3, 3)
        bob = await container.users.by_email("bob.kumar@itsm.local")
        dan = await container.users.by_email("dan.okafor@itsm.local")       # also has the Application skill
        r = await ac.post(f"/api/incidents/{inc['id']}/assign", headers=adm, json={"technician_id": str(bob["_id"])})
        assert r.status_code == 200, r.text

        await container.sla_monitor.run_once(now=parse_dt(inc["created_at"]) + timedelta(minutes=3))
        about = lambda ns: [n for n in ns if n.get("incident_id") == inc["id"]]
        assert any(n["kind"] == "escalation" for n in about(await notifications_for(str(bob["_id"]))))
        assert not about(await notifications_for(str(dan["_id"]))), "Dan cannot open Bob's incident"


@pytest.mark.anyio
async def test_reassigned_technician_no_longer_sees_old_notifications_or_pins():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        alice_h, alice = await login(ac, "alice.chen@itsm.local", "Tech@1234")
        inc = await report(ac, cust, await service_id(ac, cust, "Office Wi-Fi"), "Network", 1, 2)
        bob = await container.users.by_email("bob.kumar@itsm.local")
        await ac.post(f"/api/incidents/{inc['id']}/assign", headers=adm, json={"technician_id": alice["id"]})
        mine = (await ac.get("/api/notifications", headers=alice_h)).json()["items"]
        assert any(n.get("incident_id") == inc["id"] for n in mine)

        await ac.post(f"/api/incidents/{inc['id']}/assign", headers=adm, json={"technician_id": str(bob["_id"])})
        assert (await ac.get(f"/api/incidents/{inc['id']}", headers=alice_h)).status_code in (403, 404)
        mine = (await ac.get("/api/notifications", headers=alice_h)).json()["items"]
        assert not any(n.get("incident_id") == inc["id"] for n in mine), "old alerts would lead to access denied"
        pins = (await ac.get("/api/campus/map", headers=alice_h)).json()["points"]
        assert not any(p["id"] == inc["id"] for p in pins)


@pytest.mark.anyio
async def test_students_cannot_reach_staff_data():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        for path in ("/api/reports/overview", "/api/reports/trends", "/api/campus/map", "/api/admin/users",
                     "/api/catalog/technicians", "/api/intelligence/correlations", "/api/assets"):
            assert (await ac.get(path, headers=cust)).status_code == 403, path
        others = [i for i in (await ac.get("/api/incidents", headers=cust)).json()
                  if i.get("reporter_email") and i["reporter_email"] != "emma@example.com"]
        assert not others


def test_duplicate_lookup_hides_reports_assigned_to_others():
    from app.core.container import container
    intel = container.intel
    tech = {'id': 'tech-a', 'role': 'technician'}
    docs = [{'_id': 'x1', 'title': 'Projector broken in F102', 'description': 'projector broken', 'status': 'ASSIGNED', 'assigned_to': 'tech-b', 'number': 'INC-1', 'priority': 'P3'},
            {'_id': 'x2', 'title': 'Projector broken in F105', 'description': 'projector broken', 'status': 'CLASSIFIED', 'assigned_to': None, 'number': 'INC-2', 'priority': 'P3'}]
    from app.domain.visibility import can_view
    seen = [d['number'] for d in docs if can_view(tech, d)]
    assert seen == ['INC-2']
    found = intel.detector.find('Projector broken', 'projector broken', None, [d for d in docs if can_view(tech, d)])
    assert all(f['id'] != 'x1' for f in found)



@pytest.mark.anyio
async def test_incident_page_only_links_to_reports_the_technician_can_open():
    """Related reports on an incident page must not lead to "access denied"."""
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        alice_h, alice = await login(ac, "alice.chen@itsm.local", "Tech@1234")
        svc = await service_id(ac, cust, "Office Wi-Fi")
        words = f"Access point zq{time.time_ns()} blinking red in the reading room"
        mine = await report(ac, cust, svc, "Network", 1, 2, description=words)
        bobs = await report(ac, cust, svc, "Network", 1, 2, description=words)
        bob = await container.users.by_email("bob.kumar@itsm.local")
        for inc, tech in ((mine, alice["id"]), (bobs, str(bob["_id"]))):
            r = await ac.post(f"/api/incidents/{inc['id']}/assign", headers=adm, json={"technician_id": tech})
            assert r.status_code == 200, r.text
        r = await ac.get(f"/api/incidents/{mine['id']}", headers=alice_h)
        assert r.status_code == 200
        linked = {x["id"] for x in r.json()["related"]} | {x["id"] for x in r.json()["incident"].get("possible_duplicates") or []}
        assert bobs["id"] not in linked
        r = await ac.get(f"/api/incidents/{mine['id']}", headers=adm)
        assert bobs["id"] in {x["id"] for x in r.json()["related"]}, "the admin still sees the link"
