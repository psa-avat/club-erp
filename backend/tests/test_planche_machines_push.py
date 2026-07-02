"""
    ERP-CLUB - ERP pour Club de vol a voile
    - planche machine push tests: is_bookable eligibility filtering
"""

import sys
import types
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock

if "httpx" not in sys.modules:
    httpx_stub = types.ModuleType("httpx")
    httpx_stub.AsyncClient = object
    httpx_stub.Response = object
    httpx_stub.TimeoutException = TimeoutError
    httpx_stub.NetworkError = OSError
    httpx_stub.RequestError = OSError
    httpx_stub.Auth = object  # services.gesasso_client.WsseAuth subclasses this
    sys.modules["httpx"] = httpx_stub

if "aioboto3" not in sys.modules:
    sys.modules["aioboto3"] = types.ModuleType("aioboto3")

from services.planche_integration import PlancheIntegrationService


def _service() -> PlancheIntegrationService:
    return PlancheIntegrationService(
        base_url="https://planche.example.test",
        connection_id="club",
        token="token",
        user="user",
        password="password",
    )


class PlancheMachinesPushTests(IsolatedAsyncioTestCase):
    async def test_batch_push_machines_query_filters_non_bookable(self):
        service = _service()
        db = AsyncMock()
        db.add = Mock()  # AsyncSession.add() is synchronous
        captured = {}

        async def fake_execute(stmt):
            captured["stmt"] = stmt
            return types.SimpleNamespace(scalars=lambda: types.SimpleNamespace(all=lambda: []))

        db.execute = fake_execute

        result = await service.batch_push_machines(db)

        # Empty eligible set (mocked) — assert the query itself carries the is_bookable
        # filter, so trailers/refits/mowers are never pushed to Planche.
        self.assertEqual(result["total"], 0)
        self.assertIn("is_bookable", str(captured["stmt"]))

    async def test_machine_push_preview_query_filters_non_bookable(self):
        service = _service()
        db = AsyncMock()
        captured_stmts = []

        async def fake_execute(stmt):
            captured_stmts.append(stmt)
            return types.SimpleNamespace(scalar_one=lambda: 0, scalar_one_or_none=lambda: None)

        db.execute = fake_execute

        result = await service.get_machine_push_preview(db)

        self.assertEqual(result["eligible_count"], 0)
        self.assertIsNone(result["last_synced_at"])
        # First query is the eligibility count — must carry the same is_bookable filter as
        # batch_push_machines so the preview shown to admins matches what actually gets pushed.
        self.assertIn("is_bookable", str(captured_stmts[0]))
