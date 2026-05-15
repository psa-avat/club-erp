"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - helloasso: FastAPI routes for HelloAsso integration settings
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

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any, Literal
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_ACCOUNTING_SETTINGS
from models import User
from schemas.accounting import SystemSettingUpdateRequest
from schemas.helloasso import (
    HELLOASSO_SETTINGS_MODULE,
    HelloAssoConnectionTestResponse,
    HelloAssoPurchaseRecord,
    HelloAssoPurchasesResponse,
    HelloAssoSettingsPayload,
    HelloAssoSettingsResponse,
)
from services.accounting import get_system_setting, upsert_system_setting

router = APIRouter(prefix="/api/v1/helloasso", tags=["helloasso"])
logger = logging.getLogger(__name__)

settings_guard = Depends(require_capability(CAP_MANAGE_ACCOUNTING_SETTINGS))

DEFAULT_HELLOASSO_SETTINGS: dict[str, Any] = {
    "client_id": "",
    "client_secret": "",
    "environment": "production",
}

HELLOASSO_AUTH_URL = "https://api.helloasso.com/oauth2/token"
HELLOASSO_ORGANIZATIONS_URL = "https://api.helloasso.com/v5/users/me/organizations"
HELLOASSO_ITEMS_PATH = "/organizations/{organization_slug}/items"
HELLOASSO_ORDERS_PATH = "/organizations/{organization_slug}/orders"
ALLOWED_CAMPAIGN_TYPES = {"CrowdFunding", "Membership", "Event", "Donation", "PaymentForm", "Checkout", "Shop"}

ACTIVE_ITEM_STATES = {"Processed", "Registered"}
DONE_ITEM_STATES = {"Canceled", "Refused", "Abandoned", "Deleted"}


def _settings_payload_from_dict(settings: dict[str, Any]) -> dict[str, Any]:
    allowed_keys = HelloAssoSettingsPayload.model_fields.keys()
    return DEFAULT_HELLOASSO_SETTINGS | {
        key: value
        for key, value in settings.items()
        if key in allowed_keys and isinstance(value, str)
    }


def _response_from_setting(
    module_name: str,
    settings: dict[str, Any],
    updated_at: datetime,
    updated_by: int | None,
) -> HelloAssoSettingsResponse:
    return HelloAssoSettingsResponse(
        module_name=module_name,
        settings=_settings_payload_from_dict(settings),
        updated_at=updated_at,
        updated_by=updated_by,
    )


def _perform_form_request(
    url: str,
    payload: dict[str, str],
    timeout: float = 15.0,
) -> tuple[int, dict[str, Any]]:
    encoded = urllib_parse.urlencode(payload).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "python-requests/2.31.0",
    }
    request = urllib_request.Request(url, data=encoded, headers=headers, method="POST")

    try:
        with urllib_request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            parsed = json.loads(body) if body.strip() else {}
            return response.status, parsed
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            parsed = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            parsed = {"raw": body}
        return exc.code, parsed


def _perform_json_get(
    url: str,
    headers: dict[str, str],
    timeout: float = 15.0,
) -> tuple[int, Any]:
    request_headers = {"Accept": "application/json", "User-Agent": "python-requests/2.31.0"}
    request_headers.update(headers)
    request = urllib_request.Request(url, data=None, headers=request_headers, method="GET")

    try:
        with urllib_request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            parsed = json.loads(body) if body.strip() else {}
            return response.status, parsed
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            parsed = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            parsed = {"raw": body}
        return exc.code, parsed


async def _run_in_thread(func, *args, **kwargs):
    return await asyncio.to_thread(func, *args, **kwargs)


def _to_helloasso_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _build_full_name(first_name: str | None, last_name: str | None) -> str | None:
    parts = [part.strip() for part in (first_name or "", last_name or "") if part and part.strip()]
    if not parts:
        return None
    return " ".join(parts)


def _extract_data_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
    return []


def _normalize_item_to_record(item: dict[str, Any], source: Literal["items", "orders"]) -> HelloAssoPurchaseRecord | None:
    item_id = item.get("id")
    if not isinstance(item_id, int):
        return None

    order = item.get("order") if isinstance(item.get("order"), dict) else {}
    payer = item.get("payer") if isinstance(item.get("payer"), dict) else {}
    user = item.get("user") if isinstance(item.get("user"), dict) else {}
    payments_raw = item.get("payments") if isinstance(item.get("payments"), list) else []
    payments = [payment for payment in payments_raw if isinstance(payment, dict)]
    first_payment = payments[0] if payments else {}

    first_name = user.get("firstName") if isinstance(user.get("firstName"), str) else None
    if first_name is None:
        first_name = payer.get("firstName") if isinstance(payer.get("firstName"), str) else None

    last_name = user.get("lastName") if isinstance(user.get("lastName"), str) else None
    if last_name is None:
        last_name = payer.get("lastName") if isinstance(payer.get("lastName"), str) else None

    payment_state = first_payment.get("state") if isinstance(first_payment.get("state"), str) else None
    payment_ids = [payment.get("id") for payment in payments if isinstance(payment.get("id"), int)]

    return HelloAssoPurchaseRecord(
        id=item_id,
        order_id=order.get("id") if isinstance(order.get("id"), int) else None,
        item_id=item_id,
        source=source,
        campaign_type=order.get("formType") if isinstance(order.get("formType"), str) else None,
        form_slug=order.get("formSlug") if isinstance(order.get("formSlug"), str) else None,
        item_state=item.get("state") if isinstance(item.get("state"), str) else None,
        payment_state=payment_state,
        date=_to_helloasso_datetime(first_payment.get("date")) or _to_helloasso_datetime(order.get("date")),
        full_name=_build_full_name(first_name, last_name),
        first_name=first_name,
        last_name=last_name,
        email=payer.get("email") if isinstance(payer.get("email"), str) else None,
        phone=(
            payer.get("phoneNumber")
            if isinstance(payer.get("phoneNumber"), str)
            else payer.get("phone") if isinstance(payer.get("phone"), str) else None
        ),
        amount_cents=item.get("amount") if isinstance(item.get("amount"), int) else None,
        payment_ids=payment_ids,
    )


def _normalize_orders_to_records(orders: list[dict[str, Any]], status_filter: Literal["active", "done"]) -> list[HelloAssoPurchaseRecord]:
    expected_states = ACTIVE_ITEM_STATES if status_filter == "active" else DONE_ITEM_STATES
    records: list[HelloAssoPurchaseRecord] = []

    for order in orders:
        campaign_type = order.get("formType") if isinstance(order.get("formType"), str) else None
        form_slug = order.get("formSlug") if isinstance(order.get("formSlug"), str) else None
        payer = order.get("payer") if isinstance(order.get("payer"), dict) else {}
        payments_raw = order.get("payments") if isinstance(order.get("payments"), list) else []
        payments = [payment for payment in payments_raw if isinstance(payment, dict)]
        payment_ids = [payment.get("id") for payment in payments if isinstance(payment.get("id"), int)]
        first_payment = payments[0] if payments else {}
        payment_state = first_payment.get("state") if isinstance(first_payment.get("state"), str) else None
        order_date = _to_helloasso_datetime(order.get("date"))

        items_raw = order.get("items") if isinstance(order.get("items"), list) else []
        items = [item for item in items_raw if isinstance(item, dict)]

        for item in items:
            item_state = item.get("state") if isinstance(item.get("state"), str) else None
            if item_state not in expected_states:
                continue

            user = item.get("user") if isinstance(item.get("user"), dict) else {}
            first_name = user.get("firstName") if isinstance(user.get("firstName"), str) else None
            if first_name is None:
                first_name = payer.get("firstName") if isinstance(payer.get("firstName"), str) else None

            last_name = user.get("lastName") if isinstance(user.get("lastName"), str) else None
            if last_name is None:
                last_name = payer.get("lastName") if isinstance(payer.get("lastName"), str) else None

            item_id = item.get("id") if isinstance(item.get("id"), int) else None
            order_id = order.get("id") if isinstance(order.get("id"), int) else None
            record_id = item_id if item_id is not None else order_id
            if record_id is None:
                continue

            records.append(
                HelloAssoPurchaseRecord(
                    id=record_id,
                    order_id=order_id,
                    item_id=item_id,
                    source="orders",
                    campaign_type=campaign_type,
                    form_slug=form_slug,
                    item_state=item_state,
                    payment_state=payment_state,
                    date=_to_helloasso_datetime(first_payment.get("date")) or order_date,
                    full_name=_build_full_name(first_name, last_name),
                    first_name=first_name,
                    last_name=last_name,
                    email=payer.get("email") if isinstance(payer.get("email"), str) else None,
                    phone=(
                        payer.get("phoneNumber")
                        if isinstance(payer.get("phoneNumber"), str)
                        else payer.get("phone") if isinstance(payer.get("phone"), str) else None
                    ),
                    amount_cents=item.get("amount") if isinstance(item.get("amount"), int) else None,
                    payment_ids=payment_ids,
                )
            )

    return records


@router.get("/settings", response_model=HelloAssoSettingsResponse)
async def get_helloasso_settings_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Return the stored HelloAsso integration settings, or defaults when missing."""
    try:
        setting = await get_system_setting(db, HELLOASSO_SETTINGS_MODULE)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        return HelloAssoSettingsResponse(
            module_name=HELLOASSO_SETTINGS_MODULE,
            settings=DEFAULT_HELLOASSO_SETTINGS,
            updated_at=datetime.fromtimestamp(0, tz=UTC),
            updated_by=None,
        )

    return _response_from_setting(
        setting.module_name,
        setting.settings if isinstance(setting.settings, dict) else {},
        setting.updated_at,
        setting.updated_by,
    )


@router.put("/settings", response_model=HelloAssoSettingsResponse)
async def update_helloasso_settings_endpoint(
    request: HelloAssoSettingsPayload,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Create or update the stored HelloAsso integration settings."""
    setting = await upsert_system_setting(
        db,
        HELLOASSO_SETTINGS_MODULE,
        SystemSettingUpdateRequest(settings=request.model_dump()),
        current_user.id,
    )
    return _response_from_setting(setting.module_name, setting.settings, setting.updated_at, setting.updated_by)


@router.post("/settings/test-connection", response_model=HelloAssoConnectionTestResponse)
async def test_helloasso_connection_endpoint(
    request: HelloAssoSettingsPayload,
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """Validate HelloAsso API credentials and retrieve organization access."""
    logger.debug("Testing HelloAsso connection for user_id=%s", current_user.id)

    token_status_code, token_payload = await _run_in_thread(
        _perform_form_request,
        HELLOASSO_AUTH_URL,
        {
            "client_id": request.client_id,
            "client_secret": request.client_secret,
            "grant_type": "client_credentials",
        },
    )

    access_token = token_payload.get("access_token") if isinstance(token_payload, dict) else None
    if not (200 <= token_status_code < 300 and isinstance(access_token, str) and access_token):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Unable to authenticate with HelloAsso using the provided credentials",
                "status_code": token_status_code,
                "details": token_payload if isinstance(token_payload, dict) else {"raw": str(token_payload)},
            },
        )

    org_status_code, organizations_payload = await _run_in_thread(
        _perform_json_get,
        HELLOASSO_ORGANIZATIONS_URL,
        {"Authorization": f"Bearer {access_token}"},
    )

    if not 200 <= org_status_code < 300:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Connected to HelloAsso but failed to fetch organizations",
                "status_code": org_status_code,
                "details": organizations_payload if isinstance(organizations_payload, dict) else {"raw": str(organizations_payload)},
            },
        )

    organizations = organizations_payload if isinstance(organizations_payload, list) else []
    first_org = organizations[0] if organizations else {}
    first_slug = first_org.get("organizationSlug") if isinstance(first_org, dict) else None

    return HelloAssoConnectionTestResponse(
        success=True,
        message="Connection successful",
        status_code=org_status_code,
        organizations_count=len(organizations),
        organization_slug=first_slug if isinstance(first_slug, str) else None,
        details={"organizations": organizations},
    )


@router.get("/purchases", response_model=HelloAssoPurchasesResponse)
async def list_helloasso_purchases_endpoint(
    status_filter: Literal["active", "done"] = Query(default="active", alias="status"),
    source: Literal["items", "orders"] = Query(default="items"),
    campaign_type: str | None = Query(default=None),
    page_size: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    """List HelloAsso purchases with active/done filtering from items or orders endpoints."""
    logger.debug(
        "Listing HelloAsso purchases for user_id=%s status=%s source=%s page_size=%s",
        current_user.id,
        status_filter,
        source,
        page_size,
    )

    normalized_campaign_types: list[str] = []
    if isinstance(campaign_type, str) and campaign_type.strip():
        normalized_campaign_types = list(
            dict.fromkeys(
                value.strip()
                for value in campaign_type.split(",")
                if value.strip()
            )
        )

    invalid_campaign_types = [value for value in normalized_campaign_types if value not in ALLOWED_CAMPAIGN_TYPES]
    if invalid_campaign_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Invalid campaign_type value",
                "invalid_values": invalid_campaign_types,
                "allowed_values": sorted(ALLOWED_CAMPAIGN_TYPES),
            },
        )

    try:
        setting = await get_system_setting(db, HELLOASSO_SETTINGS_MODULE)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="HelloAsso settings are not configured",
            ) from exc
        raise

    settings = setting.settings if isinstance(setting.settings, dict) else {}
    client_id = settings.get("client_id") if isinstance(settings.get("client_id"), str) else ""
    client_secret = settings.get("client_secret") if isinstance(settings.get("client_secret"), str) else ""
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="HelloAsso settings must include client_id and client_secret",
        )

    token_status_code, token_payload = await _run_in_thread(
        _perform_form_request,
        HELLOASSO_AUTH_URL,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
        },
    )

    access_token = token_payload.get("access_token") if isinstance(token_payload, dict) else None
    if not (200 <= token_status_code < 300 and isinstance(access_token, str) and access_token):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Unable to authenticate with HelloAsso using the configured credentials",
                "status_code": token_status_code,
                "details": token_payload if isinstance(token_payload, dict) else {"raw": str(token_payload)},
            },
        )

    auth_headers = {"Authorization": f"Bearer {access_token}"}
    org_status_code, organizations_payload = await _run_in_thread(
        _perform_json_get,
        HELLOASSO_ORGANIZATIONS_URL,
        auth_headers,
    )
    if not 200 <= org_status_code < 300:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Connected to HelloAsso but failed to fetch organizations",
                "status_code": org_status_code,
                "details": organizations_payload if isinstance(organizations_payload, dict) else {"raw": str(organizations_payload)},
            },
        )

    organizations = organizations_payload if isinstance(organizations_payload, list) else []
    first_org = organizations[0] if organizations else {}
    organization_slug = first_org.get("organizationSlug") if isinstance(first_org, dict) else None
    if not isinstance(organization_slug, str) or not organization_slug:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No HelloAsso organization is available for the configured credentials",
        )

    if source == "items":
        item_states = sorted(ACTIVE_ITEM_STATES if status_filter == "active" else DONE_ITEM_STATES)
        query = urllib_parse.urlencode(
            {
                "pageIndex": 1,
                "pageSize": page_size,
                "withDetails": "true",
                "sortOrder": "Desc",
                "itemStates": item_states,
            },
            doseq=True,
        )
        url = f"https://api.helloasso.com/v5{HELLOASSO_ITEMS_PATH.format(organization_slug=organization_slug)}?{query}"
        items_status_code, items_payload = await _run_in_thread(_perform_json_get, url, auth_headers)
        if not 200 <= items_status_code < 300:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "message": "Unable to fetch HelloAsso items",
                    "status_code": items_status_code,
                    "details": items_payload if isinstance(items_payload, dict) else {"raw": str(items_payload)},
                },
            )

        items = _extract_data_list(items_payload)
        records = [
            record
            for item in items
            for record in [_normalize_item_to_record(item, "items")]
            if record is not None
        ]
        if normalized_campaign_types:
            allowed = set(normalized_campaign_types)
            records = [record for record in records if record.campaign_type in allowed]
    else:
        query_params: dict[str, Any] = {
            "pageIndex": 1,
            "pageSize": page_size,
            "withDetails": "true",
            "sortOrder": "Desc",
        }
        if normalized_campaign_types:
            query_params["formTypes"] = normalized_campaign_types

        query = urllib_parse.urlencode(query_params, doseq=True)
        url = f"https://api.helloasso.com/v5{HELLOASSO_ORDERS_PATH.format(organization_slug=organization_slug)}?{query}"
        orders_status_code, orders_payload = await _run_in_thread(_perform_json_get, url, auth_headers)
        if not 200 <= orders_status_code < 300:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "message": "Unable to fetch HelloAsso orders",
                    "status_code": orders_status_code,
                    "details": orders_payload if isinstance(orders_payload, dict) else {"raw": str(orders_payload)},
                },
            )

        orders = _extract_data_list(orders_payload)
        records = _normalize_orders_to_records(orders, status_filter)
        if normalized_campaign_types:
            allowed = set(normalized_campaign_types)
            records = [record for record in records if record.campaign_type in allowed]

    return HelloAssoPurchasesResponse(
        organization_slug=organization_slug,
        status=status_filter,
        source=source,
        campaign_type=",".join(normalized_campaign_types) if normalized_campaign_types else None,
        count=len(records),
        purchases=records,
    )
