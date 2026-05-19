"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - helloasso token cache tests: verify 30-minute token reuse behavior
    Copyright (C) 2026  SAFORCADA Patrick
"""

from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from api.routes.helloasso import _HELLOASSO_TOKEN_CACHE, _get_cached_helloasso_token


class HelloAssoTokenCacheTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        _HELLOASSO_TOKEN_CACHE["access_token"] = None
        _HELLOASSO_TOKEN_CACHE["expires_at"] = 0.0
        _HELLOASSO_TOKEN_CACHE["client_id"] = None

    async def test_token_is_cached_for_same_client(self):
        with patch(
            "api.routes.helloasso._run_in_thread",
            new=AsyncMock(return_value=(200, {"access_token": "token-1"})),
        ) as run_in_thread:
            token_first = await _get_cached_helloasso_token("client-a", "secret-a")
            token_second = await _get_cached_helloasso_token("client-a", "secret-a")

        self.assertEqual(token_first, "token-1")
        self.assertEqual(token_second, "token-1")
        self.assertEqual(run_in_thread.await_count, 1)

    async def test_cache_is_scoped_per_client(self):
        with patch(
            "api.routes.helloasso._run_in_thread",
            new=AsyncMock(side_effect=[(200, {"access_token": "token-a"}), (200, {"access_token": "token-b"})]),
        ) as run_in_thread:
            token_a = await _get_cached_helloasso_token("client-a", "secret-a")
            token_b = await _get_cached_helloasso_token("client-b", "secret-b")

        self.assertEqual(token_a, "token-a")
        self.assertEqual(token_b, "token-b")
        self.assertEqual(run_in_thread.await_count, 2)
