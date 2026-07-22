"""Business logic for member recap emails and their message templates."""

from __future__ import annotations

import html
import os
from decimal import Decimal
from typing import Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Member, MemberRecapMessageTemplate, ValidatedFlight
from schemas.members import (
    MemberRecapMessageTemplateCreateRequest,
    MemberRecapMessageTemplateResponse,
    MemberRecapMessageTemplateUpdateRequest,
    RecapEmailBulkResult,
)
from services.email import send_member_recap_email
from services.members import get_member_account_summary

PORTAL_BASE_URL = os.getenv("PORTAL_BASE_URL", "http://localhost:8080")


def _duration_minutes(takeoff_time: Optional[str], landing_time: Optional[str]) -> Optional[int]:
    """Compute flight duration in minutes from takeoff/landing HH:MM strings."""
    if not takeoff_time or not landing_time:
        return None
    try:
        th, tm = takeoff_time.split(":")
        lh, lm = landing_time.split(":")
        takeoff_min = int(th) * 60 + int(tm)
        landing_min = int(lh) * 60 + int(lm)
        if landing_min >= takeoff_min:
            return landing_min - takeoff_min
    except (ValueError, AttributeError):
        pass
    return None


def _format_flight_hours(total_minutes: int) -> str:
    hours, minutes = divmod(total_minutes, 60)
    return f"{hours}h{minutes:02d}" if minutes else f"{hours}h"


def _format_balance(balance: Decimal) -> str:
    formatted = f"{balance:,.2f}".replace(",", " ").replace(".", ",")
    return f"{formatted} €"


async def get_member_flight_totals(db: AsyncSession, member: Member) -> tuple[int, int]:
    """Return (flight_count, total_duration_minutes) for a member, pilot or second pilot."""

    stmt = select(
        ValidatedFlight.takeoff_time,
        ValidatedFlight.landing_time,
    ).where(
        or_(
            ValidatedFlight.pilot_erp_id == member.account_id,
            ValidatedFlight.second_pilot_erp_id == member.account_id,
        )
    )
    result = await db.execute(stmt)
    rows = result.all()

    flight_count = len(rows)
    total_minutes = 0
    for takeoff_time, landing_time in rows:
        duration = _duration_minutes(takeoff_time, landing_time)
        if duration is not None:
            total_minutes += duration

    return flight_count, total_minutes


async def send_recap_email(
    db: AsyncSession,
    member: Member,
    message_text: str,
    *,
    portal_base_url: str = PORTAL_BASE_URL,
) -> bool:
    """Send a recap email to one member. Returns False (no exception) if the member has no email."""

    if not member.email:
        return False

    flight_count, total_minutes = await get_member_flight_totals(db, member)
    account_summary = await get_member_account_summary(db, member.uuid)

    return await send_member_recap_email(
        email_to=member.email,
        member_name=f"{member.first_name} {member.last_name}",
        message_text=html.escape(message_text),
        flight_count=flight_count,
        flight_hours=_format_flight_hours(total_minutes),
        balance=_format_balance(account_summary.current_balance),
        portal_url=f"{portal_base_url}/member-portal/login",
    )


async def send_recap_emails_bulk(
    db: AsyncSession,
    message_text: str,
    *,
    member_uuids: Optional[list[UUID]] = None,
    portal_base_url: str = PORTAL_BASE_URL,
) -> RecapEmailBulkResult:
    """Send recap emails.

    With `member_uuids`, sends only to those members (explicit selection).
    Otherwise sends to every active member with an email on file.
    """

    if member_uuids is not None:
        stmt = select(Member).where(Member.uuid.in_(member_uuids))
    else:
        stmt = select(Member).where(Member.status == 1)
    result = await db.execute(stmt)
    members = result.scalars().all()

    sent = 0
    skipped_no_email = 0
    failed = 0
    for member in members:
        if not member.email:
            skipped_no_email += 1
            continue
        success = await send_recap_email(db, member, message_text, portal_base_url=portal_base_url)
        if success:
            sent += 1
        else:
            failed += 1

    return RecapEmailBulkResult(sent=sent, skipped_no_email=skipped_no_email, failed=failed)


# ---------------------------------------------------------------------------
# Recap message templates
# ---------------------------------------------------------------------------

async def list_recap_templates(db: AsyncSession) -> list[MemberRecapMessageTemplateResponse]:
    result = await db.execute(
        select(MemberRecapMessageTemplate).order_by(MemberRecapMessageTemplate.label)
    )
    return [
        MemberRecapMessageTemplateResponse.model_validate(template)
        for template in result.scalars().all()
    ]


async def get_recap_template_or_404(db: AsyncSession, template_uuid: UUID) -> MemberRecapMessageTemplate:
    template = await db.get(MemberRecapMessageTemplate, template_uuid)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recap message template not found")
    return template


async def create_recap_template(
    db: AsyncSession,
    payload: MemberRecapMessageTemplateCreateRequest,
    *,
    created_by_user_id: int,
) -> MemberRecapMessageTemplate:
    template = MemberRecapMessageTemplate(
        uuid=uuid4(),
        label=payload.label,
        body=payload.body,
        created_by=created_by_user_id,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


async def update_recap_template(
    db: AsyncSession,
    template_uuid: UUID,
    payload: MemberRecapMessageTemplateUpdateRequest,
) -> MemberRecapMessageTemplate:
    template = await get_recap_template_or_404(db, template_uuid)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        setattr(template, field_name, value)
    await db.commit()
    await db.refresh(template)
    return template


async def delete_recap_template(db: AsyncSession, template_uuid: UUID) -> None:
    template = await get_recap_template_or_404(db, template_uuid)
    await db.delete(template)
    await db.commit()
