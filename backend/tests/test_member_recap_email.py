"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - member recap email tests: flight totals aggregate, single/bulk send, template CRUD, capability guard
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 """
from decimal import Decimal
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from uuid import uuid4

from api.routes.members import router
from schemas.members import (
    AccountSummaryResponse,
    MemberRecapMessageTemplateCreateRequest,
    MemberRecapMessageTemplateUpdateRequest,
)
from services import member_recap


def _route(path: str, method: str):
    # members.router is included with prefix="/api/v1/members" in main.py, but the
    # router itself is created with APIRouter() (no baked-in prefix), so route.path
    # here is relative — unlike e.g. assets.router which bakes its prefix in.
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route
    return None


def _guarded(route) -> bool:
    dependency_names = [
        dependency.call.__name__
        for dependency in route.dependant.dependencies
        if getattr(dependency, "call", None) is not None
    ]
    return "_capability_guard" in dependency_names


class RecapEmailRouteGuardTests(TestCase):
    def test_send_bulk_route_is_guarded(self):
        route = _route("/recap-emails/send-bulk", "POST")
        self.assertIsNotNone(route)
        self.assertTrue(_guarded(route))

    def test_send_single_route_is_guarded(self):
        route = _route("/{member_uuid:uuid}/send-recap-email", "POST")
        self.assertIsNotNone(route)
        self.assertTrue(_guarded(route))

    def test_template_crud_routes_are_guarded(self):
        for path, method in [
            ("/recap-message-templates", "GET"),
            ("/recap-message-templates", "POST"),
            ("/recap-message-templates/{template_uuid:uuid}", "PATCH"),
            ("/recap-message-templates/{template_uuid:uuid}", "DELETE"),
        ]:
            route = _route(path, method)
            self.assertIsNotNone(route, f"Missing {method} {path}")
            self.assertTrue(_guarded(route), f"{method} {path} is not capability-guarded")


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def scalars(self):
        return SimpleNamespace(all=lambda: self._rows)


class _FakeDb:
    def __init__(self, execute_results):
        self.execute_results = list(execute_results)
        self.added = []
        self.deleted = []
        self.committed = 0

    async def execute(self, *_args, **_kwargs):
        return self.execute_results.pop(0)

    async def commit(self):
        self.committed += 1

    async def refresh(self, obj):
        pass

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def get(self, model, obj_id):
        for obj in self.added:
            if getattr(obj, "uuid", None) == obj_id:
                return obj
        return None


def _member(*, account_id="ME2026-0001", email="pilot@example.com"):
    return SimpleNamespace(
        uuid=uuid4(),
        account_id=account_id,
        first_name="Jean",
        last_name="Dupont",
        email=email,
    )


class MemberFlightTotalsTests(IsolatedAsyncioTestCase):
    async def test_counts_flights_and_sums_duration(self):
        rows = [("10:00", "11:30"), ("14:00", "14:45")]
        db = _FakeDb([_FakeResult(rows)])
        member = _member()

        count, total_minutes = await member_recap.get_member_flight_totals(db, member)

        self.assertEqual(count, 2)
        self.assertEqual(total_minutes, 90 + 45)

    async def test_ignores_rows_with_invalid_or_missing_times(self):
        rows = [("10:00", None), ("09:00", "08:00"), ("08:00", "08:30")]
        db = _FakeDb([_FakeResult(rows)])
        member = _member()

        count, total_minutes = await member_recap.get_member_flight_totals(db, member)

        # count reflects all matching flights; only the valid one contributes duration
        self.assertEqual(count, 3)
        self.assertEqual(total_minutes, 30)


class SendRecapEmailTests(IsolatedAsyncioTestCase):
    async def test_skips_member_without_email(self):
        member = _member(email=None)
        db = _FakeDb([])

        result = await member_recap.send_recap_email(db, member, "Bonjour !")

        self.assertFalse(result)

    async def test_sends_with_formatted_totals_and_escaped_message(self):
        member = _member()
        db = _FakeDb([
            _FakeResult([("10:00", "11:30")]),  # flight totals query
        ])

        recorded = {}

        async def _fake_send(**kwargs):
            recorded.update(kwargs)
            return True

        original_summary = member_recap.get_member_account_summary

        async def _fake_account_summary(_db, _member_uuid, **_kwargs):
            return AccountSummaryResponse(current_balance=Decimal("42"), pending_total=Decimal("-2"), posted_total=Decimal("42"))

        member_recap.get_member_account_summary = _fake_account_summary
        member_recap.send_member_recap_email = _fake_send
        try:
            result = await member_recap.send_recap_email(db, member, "<b>Salut</b> {{name}}")
        finally:
            member_recap.get_member_account_summary = original_summary

        self.assertTrue(result)
        self.assertEqual(recorded["email_to"], "pilot@example.com")
        self.assertEqual(recorded["flight_count"], 1)
        self.assertEqual(recorded["flight_hours"], "1h30")
        self.assertEqual(recorded["balance"], "42,00 €")
        self.assertNotIn("<b>", recorded["message_text"])  # HTML-escaped
        self.assertIn("&lt;b&gt;", recorded["message_text"])


class SendRecapEmailsBulkTests(IsolatedAsyncioTestCase):
    async def test_tallies_sent_skipped_and_failed(self):
        members = [
            _member(email="a@example.com"),
            _member(email=None),
            _member(email="c@example.com"),
        ]
        db = _FakeDb([_FakeResult(members)])

        outcomes = {members[0].uuid: True, members[2].uuid: False}

        async def _fake_send_recap_email(_db, member, _message, **_kwargs):
            return outcomes[member.uuid]

        original = member_recap.send_recap_email
        member_recap.send_recap_email = _fake_send_recap_email
        try:
            result = await member_recap.send_recap_emails_bulk(db, "Bonjour")
        finally:
            member_recap.send_recap_email = original

        self.assertEqual(result.sent, 1)
        self.assertEqual(result.skipped_no_email, 1)
        self.assertEqual(result.failed, 1)


class RecapTemplateCrudTests(IsolatedAsyncioTestCase):
    async def test_create_then_update_then_delete(self):
        db = _FakeDb([])

        created = await member_recap.create_recap_template(
            db,
            MemberRecapMessageTemplateCreateRequest(label="Relance", body="Merci de vous reinscrire."),
            created_by_user_id=1,
        )
        self.assertEqual(created.label, "Relance")
        self.assertEqual(db.committed, 1)

        db.execute_results = []
        updated = await member_recap.update_recap_template(
            db,
            created.uuid,
            MemberRecapMessageTemplateUpdateRequest(label="Relance 2026"),
        )
        self.assertEqual(updated.label, "Relance 2026")
        self.assertEqual(updated.body, "Merci de vous reinscrire.")

        await member_recap.delete_recap_template(db, created.uuid)
        self.assertIn(created, db.deleted)
