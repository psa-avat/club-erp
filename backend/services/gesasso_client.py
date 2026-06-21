"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - gesasso_client: WSSE authentication and GesAsso API client for pilot data lookup
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

from __future__ import annotations

import base64
import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Any, Generator

import httpx

logger = logging.getLogger(__name__)


class WsseAuth(httpx.Auth):
    """
    httpx auth handler for WSSE UsernameToken authentication.

    Generates a fresh nonce and timestamp per request, as required by GesAsso.
    PasswordDigest = Base64(SHA1(nonce || created || secret))
    """

    def __init__(self, username: str, secret: str) -> None:
        self.username = username
        self.secret = secret

    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        nonce = os.urandom(16)
        b64_nonce = base64.b64encode(nonce).decode("utf-8")
        created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        sha1_input = nonce + created.encode("utf-8") + self.secret.encode("utf-8")
        password_digest = base64.b64encode(hashlib.sha1(sha1_input).digest()).decode("utf-8")

        request.headers["X-WSSE"] = (
            f'UsernameToken Username="{self.username}", '
            f'PasswordDigest="{password_digest}", '
            f'Nonce="{b64_nonce}", '
            f'Created="{created}"'
        )
        yield request


class GesAssoClient:
    """
    Async client for the GesAsso FFVP API.

    Covers:
      GET /people/{ffvp_id}.json → personal info (name, licence number, phone)
    Qualifications are handled exclusively by PlancheBack, not by the ERP.
    """

    def __init__(self, base_url: str, username: str, secret: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth = WsseAuth(username, secret)

    async def get_pilot_personal_info(self, ffvp_id: int) -> dict[str, Any]:
        """
        Fetch pilot personal data from GesAsso.

        Returns the raw JSON dict from /people/{ffvp_id}.json.
        Raises httpx.HTTPStatusError on non-2xx responses.
        """
        url = f"{self.base_url}/people/{ffvp_id}.json"
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            response = await client.get(url, auth=self.auth)
            response.raise_for_status()
            return response.json()
