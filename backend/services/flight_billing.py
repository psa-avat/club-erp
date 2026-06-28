"""
    ERP-CLUB - ERP pour Club de vol a voile
    - flight_billing: side-effect-free billing preview for imported Planche flights
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from models import (
    AccountingAccount,
    Asset,
    FlightBillingSettings,
    FlightType,
    Member,
    PackApplicability,
    PackDefinition,
    PricingItem,
    PricingItemTier,
    PricingVersion,
    ValidatedFlight,
    ViEntitlement,
    ViTypeCatalog,
)
from schemas.flights import (
    FlightAccountingLinePreview,
    FlightBillingAppliedLinePreview,
    FlightBillingBatchPreviewResponse,
    FlightBillingError,
    FlightBillingPayerPreview,
    FlightBillingPreviewRequest,
    FlightBillingPreviewResponse,
)


PRICING_STATUS_ACTIVE = 2
UNIT_FLIGHT_TIME_HOURS = 1
UNIT_ENGINE_TIME_MINUTE = 2
UNIT_ENGINE_TIME_1_100H = 3
UNIT_FLIGHT_DURATION = 4
UNIT_PER_FLIGHT = 5
UNIT_FIXED = 6
UNIT_FIXED_DURATION_TRANCHE = 7  # Fixed price per duration bracket (e.g. TREUIL)

FLIGHT_TYPE_LABELS: dict[int, str] = {
    0: "instruction",
    1: "solo",
    2: "initiation",
    3: "partage",
    4: "passager",
    5: "lacher",
    6: "supervise",
    7: "essai",
}

PACK_CONSUMING_UNITS = {UNIT_FLIGHT_TIME_HOURS, UNIT_ENGINE_TIME_1_100H, UNIT_FLIGHT_DURATION}


@dataclass
class _Payer:
    member: Member | None
    role: str
    share: Decimal
    reason: str


@dataclass
class _PricedMachine:
    source: str
    asset: Asset | None
    version: PricingVersion | None
    items: list[PricingItem]


@dataclass
class _ClubBillingInfo:
    """Context for club-billed flights (initiation/VI charged to club)."""
    is_club_billed: bool
    charge_account_uuid: UUID | None
    charge_account_code: str | None
    # Set when the VI type has analytical accounts: D 921 / C 902 replaces D 6067 / C 706x
    vi_analytical_credit_account: AccountingAccount | None = None


def _dec(value: object, default: str = "0") -> Decimal:
    if value is None:
        return Decimal(default)
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _parse_uuid(value: str | UUID | None) -> UUID | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _full_name(member: Member | None) -> str | None:
    if member is None:
        return None
    return " ".join(part for part in [member.first_name, member.last_name] if part) or None


def _flight_duration_hours(flight: ValidatedFlight) -> Decimal | None:
    if not flight.takeoff_time or not flight.landing_time:
        return None
    try:
        takeoff = datetime.strptime(flight.takeoff_time[:5], "%H:%M")
        landing = datetime.strptime(flight.landing_time[:5], "%H:%M")
    except ValueError:
        return None
    if landing < takeoff:
        landing += timedelta(days=1)
    minutes = Decimal(str(int((landing - takeoff).total_seconds() // 60)))
    return (minutes / Decimal("60")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _flight_duration_minutes(flight: ValidatedFlight) -> Decimal | None:
    """Return flight duration in whole minutes."""
    if not flight.takeoff_time or not flight.landing_time:
        return None
    try:
        takeoff = datetime.strptime(flight.takeoff_time[:5], "%H:%M")
        landing = datetime.strptime(flight.landing_time[:5], "%H:%M")
    except ValueError:
        return None
    if landing < takeoff:
        landing += timedelta(days=1)
    return Decimal(str(int((landing - takeoff).total_seconds() // 60)))


def _resolve_engine_time(flight: ValidatedFlight) -> Decimal | None:
    """Return engine_time in 1/100th hours, computing from index difference if needed."""
    raw = flight.engine_time
    if raw is None and flight.start_index is not None and flight.stop_index is not None:
        raw = round(flight.stop_index - flight.start_index, 2)
    return _dec(raw) if raw is not None else None


def _quantity_for_item(item: PricingItem, flight: ValidatedFlight) -> Decimal | None:
    if item.unit in {UNIT_FLIGHT_TIME_HOURS, UNIT_FLIGHT_DURATION}:
        return _flight_duration_hours(flight)
    if item.unit == UNIT_FIXED_DURATION_TRANCHE:
        return _flight_duration_minutes(flight)
    if item.unit == UNIT_ENGINE_TIME_MINUTE:
        raw = _resolve_engine_time(flight)
        if raw is None:
            return None
        return (raw * Decimal("100") * Decimal("60")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if item.unit == UNIT_ENGINE_TIME_1_100H:
        raw = _resolve_engine_time(flight)
        if raw is None:
            return None
        return (raw * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if item.unit in {UNIT_PER_FLIGHT, UNIT_FIXED}:
        return Decimal("1")
    return None


def _select_tier(item: PricingItem, quantity: Decimal) -> PricingItemTier | None:
    selected: PricingItemTier | None = None
    for tier in sorted(item.tiers or [], key=lambda t: (_dec(t.from_qty), t.sort_order or 0)):
        if _dec(tier.from_qty) <= quantity:
            selected = tier
        else:
            break
    return selected


def _progressive_split(
    item: PricingItem, quantity: Decimal
) -> list[tuple[Decimal, Decimal]]:
    """Split *quantity* across progressive brackets and return ``(qty_in_bracket, rate)`` pairs.

    The implicit bracket at 0 uses ``item.base_price``.  Explicit tiers are
    sorted by ``from_qty`` and each covers ``[from_qty, next_from_qty)``.
    Any remainder beyond the last tier uses the last tier's price.
    """
    if not item.tiers:
        return [(quantity, _dec(item.base_price))]

    sorted_tiers = sorted(item.tiers, key=lambda t: (_dec(t.from_qty), t.sort_order or 0))
    # Calculate bracket boundaries
    boundaries: list[Decimal] = [Decimal("0")]
    for t in sorted_tiers:
        boundaries.append(_dec(t.from_qty))
    # Pair each bracket with its rate (base_price for [0, first_tier.from_qty), then each tier)
    prices: list[Decimal] = [_dec(item.base_price)]
    for t in sorted_tiers:
        prices.append(_dec(t.price))

    result: list[tuple[Decimal, Decimal]] = []
    remaining = quantity
    for i in range(len(boundaries)):
        bracket_start = boundaries[i]
        bracket_end = boundaries[i + 1] if i + 1 < len(boundaries) else None
        bracket_size = (bracket_end - bracket_start) if bracket_end is not None else remaining
        if bracket_size <= 0:
            continue
        used = min(remaining, bracket_size)
        if used <= 0:
            break
        result.append((used, prices[i]))
        remaining -= used
        if remaining <= 0:
            break

    # Any remaining (beyond last explicit tier) uses the last tier's price
    if remaining > 0 and prices:
        result.append((remaining, prices[-1]))

    return result


def _split_progressive_brackets_by_share(
    brackets: list[tuple[Decimal, Decimal]],
    share: Decimal,
) -> list[tuple[Decimal, Decimal]]:
    """Allocate full-flight progressive brackets to a payer share."""
    allocated: list[tuple[Decimal, Decimal]] = []
    for bracket_qty, bracket_rate in brackets:
        payer_qty = (bracket_qty * share).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        if payer_qty > 0:
            allocated.append((payer_qty, bracket_rate))
    return allocated


def _error(code: str, message: str, *, scope: str = "flight", blocking: bool = True) -> FlightBillingError:
    return FlightBillingError(code=code, message=message, scope=scope, blocking=blocking)


class FlightBillingPreviewService:
    """Calculate flight billing previews without mutating accounting or packs."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._billing_settings: FlightBillingSettings | None = None
        self._club_member: Member | None = None

    async def _load_billing_settings(self, fiscal_year_uuid: UUID | None) -> None:
        """Load FlightBillingSettings and resolve club member for club billing detection."""
        if fiscal_year_uuid is None:
            return
        result = await self.db.execute(
            select(FlightBillingSettings).where(
                FlightBillingSettings.fiscal_year_uuid == fiscal_year_uuid
            )
        )
        self._billing_settings = result.scalar_one_or_none()
        if self._billing_settings and self._billing_settings.club_member_uuid:
            member_result = await self.db.execute(
                select(Member).where(Member.uuid == self._billing_settings.club_member_uuid)
            )
            self._club_member = member_result.scalar_one_or_none()
        else:
            self._club_member = None

    async def _resolve_charge_account(
        self, flight: ValidatedFlight, is_initiation: bool = True
    ) -> tuple[UUID | None, str | None, AccountingAccount | None]:
        """
        Resolve the charge/debit account for a club-billed flight.

        For initiation VI flights with analytical accounts configured:
            debit = vi_type.analytical_cost_account_uuid (e.g. 921)
            credit_override = vi_type.analytical_reflection_account (e.g. 902)

        For other initiation flights:
            vi_type_catalog.charge_account_uuid → settings.default_initiation_charge_account_uuid

        For other club-billed flights (is_initiation=False):
            settings.club_charge_account_uuid → settings.default_initiation_charge_account_uuid (fallback)

        Returns (charge_account_uuid, charge_account_code, vi_analytical_credit_account).
        """
        charge_account_uuid: UUID | None = None
        charge_account_code: str | None = None
        vi_analytical_credit_account: AccountingAccount | None = None

        if is_initiation and flight.vi_erp_id:
            # vi_erp_id is the entitlement code (e.g. VI2026-0001), not the type code.
            # Look up the entitlement and follow its vi_type relationship.
            vi_result = await self.db.execute(
                select(ViEntitlement)
                .options(
                    joinedload(ViEntitlement.vi_type).options(
                        joinedload(ViTypeCatalog.charge_account),
                        joinedload(ViTypeCatalog.analytical_cost_account),
                        joinedload(ViTypeCatalog.analytical_reflection_account),
                    )
                )
                .where(ViEntitlement.code == flight.vi_erp_id)
            )
            entitlement = vi_result.unique().scalar_one_or_none()
            vi_type = entitlement.vi_type if entitlement else None
            if vi_type:
                if vi_type.analytical_cost_account_uuid and vi_type.analytical_reflection_account_uuid:
                    # VI analytical mode: D 921 / C 902
                    charge_account_uuid = vi_type.analytical_cost_account_uuid
                    charge_account_code = vi_type.analytical_cost_account.code if vi_type.analytical_cost_account else None
                    vi_analytical_credit_account = vi_type.analytical_reflection_account
                elif vi_type.charge_account_uuid:
                    # Fallback to standard charge account override from VI type
                    charge_account_uuid = vi_type.charge_account_uuid
                    charge_account_code = vi_type.charge_account_code

        if charge_account_uuid is None and self._billing_settings:
            if is_initiation:
                # Fallback for initiation: default_initiation_charge_account_uuid
                charge_account_uuid = self._billing_settings.default_initiation_charge_account_uuid
            else:
                # Club-billed (non-initiation): use club_charge_account_uuid, fallback to initiation account
                charge_account_uuid = self._billing_settings.club_charge_account_uuid or self._billing_settings.default_initiation_charge_account_uuid

            if charge_account_uuid:
                acct_result = await self.db.execute(
                    select(AccountingAccount).where(AccountingAccount.uuid == charge_account_uuid)
                )
                acct = acct_result.scalar_one_or_none()
                if acct:
                    charge_account_code = acct.code

        return charge_account_uuid, charge_account_code, vi_analytical_credit_account

    async def _resolve_club_billing(
        self, flight: ValidatedFlight
    ) -> _ClubBillingInfo:
        """
        Check if the flight is club-billed and resolve the charge account.

        Detection order:
        1. charge_to_erp_id matches the club member's account_id (explicit club billing)
        2. Flight type is 'initiation' and a charge account can be resolved
           (from vi_type_catalog.charge_account_uuid or settings default)

        Charge account resolution order:
        vi_type_catalog.charge_account_uuid → settings.default_initiation_charge_account_uuid
        """
        flight_type = FLIGHT_TYPE_LABELS.get(flight.type_of_flight, "unknown")
        is_initiation = flight_type == "initiation"

        # ── Detection 1: charge_to_erp_id matches club member account_id ──
        is_club_billed = False
        if self._club_member is not None and flight.charge_to_erp_id:
            if flight.charge_to_erp_id == self._club_member.account_id:
                is_club_billed = True

        # ── Detection 2: initiation flight with a resolvable charge account ──
        charge_account_uuid: UUID | None = None
        charge_account_code: str | None = None
        vi_analytical_credit_account: AccountingAccount | None = None
        if not is_club_billed and is_initiation:
            ca_uuid, ca_code, vi_credit = await self._resolve_charge_account(flight, is_initiation=True)
            if ca_uuid is not None:
                is_club_billed = True
                charge_account_uuid = ca_uuid
                charge_account_code = ca_code
                vi_analytical_credit_account = vi_credit

        if not is_club_billed:
            return _ClubBillingInfo(
                is_club_billed=False, charge_account_uuid=None, charge_account_code=None
            )

        # Detection 1 (club member match): resolve charge account now if not already resolved
        if charge_account_uuid is None:
            charge_account_uuid, charge_account_code, _ = await self._resolve_charge_account(
                flight, is_initiation=False
            )

        return _ClubBillingInfo(
            is_club_billed=True,
            charge_account_uuid=charge_account_uuid,
            charge_account_code=charge_account_code,
            vi_analytical_credit_account=vi_analytical_credit_account,
        )

    async def preview_flight(
        self,
        flight_uuid: UUID | str,
        fiscal_year_uuid: UUID | None = None,
    ) -> FlightBillingPreviewResponse:
        flight = await self._get_flight(flight_uuid)
        await self._load_billing_settings(fiscal_year_uuid)
        club_info = await self._resolve_club_billing(flight)
        pack_balances = await self._initial_pack_balances([flight])
        item_packs = await self._build_item_packs_map()
        return await self._preview_one(flight, pack_balances, item_packs, club_info=club_info)

    async def preview_batch(
        self,
        request: FlightBillingPreviewRequest,
        fiscal_year_uuid: UUID | None = None,
    ) -> FlightBillingBatchPreviewResponse:
        flights = await self._list_flights(request)
        if not flights:
            return FlightBillingBatchPreviewResponse(items=[])

        # Load settings once for the batch (uses first flight's FY if available)
        await self._load_billing_settings(fiscal_year_uuid)

        pack_balances = await self._initial_pack_balances(flights)
        item_packs = await self._build_item_packs_map()

        sorted_flights = sorted(flights, key=lambda f: (f.jour, f.takeoff_time or "", str(f.uuid)))
        sem = asyncio.Semaphore(5)  # limit concurrent DB access

        async def _preview_with_sem(flight: ValidatedFlight) -> FlightBillingPreviewResponse:
            async with sem:
                club_info = await self._resolve_club_billing(flight)
                return await self._preview_one(flight, pack_balances, item_packs, club_info=club_info)

        previews = await asyncio.gather(*[_preview_with_sem(f) for f in sorted_flights])
        total_amount = sum((p.total_amount for p in previews), Decimal("0"))
        return FlightBillingBatchPreviewResponse(
            items=previews,
            total=len(previews),
            billable_count=sum(1 for p in previews if p.can_apply),
            error_count=sum(1 for p in previews if p.errors),
            total_amount=_money(total_amount),
        )

    async def _get_flight(self, flight_uuid: UUID | str) -> ValidatedFlight:
        parsed = _parse_uuid(flight_uuid)
        filters = [ValidatedFlight.uuid == parsed] if parsed else [ValidatedFlight.planche_uuid == str(flight_uuid)]
        result = await self.db.execute(select(ValidatedFlight).where(or_(*filters)))
        flight = result.scalars().first()
        if flight is None:
            raise ValueError(f"Flight {flight_uuid} not found")
        return flight

    async def _list_flights(self, request: FlightBillingPreviewRequest) -> list[ValidatedFlight]:
        filters = []
        if request.flight_uuids:
            parsed = [_parse_uuid(value) for value in request.flight_uuids]
            uuid_values = [value for value in parsed if value is not None]
            planche_values = [value for value in request.flight_uuids if _parse_uuid(value) is None]
            parts = []
            if uuid_values:
                parts.append(ValidatedFlight.uuid.in_(uuid_values))
            if planche_values:
                parts.append(ValidatedFlight.planche_uuid.in_(planche_values))
            filters.append(or_(*parts))
        if request.date_from is not None:
            filters.append(ValidatedFlight.jour >= request.date_from)
        if request.date_to is not None:
            filters.append(ValidatedFlight.jour <= request.date_to)
        if not request.include_already_billed:
            filters.append(ValidatedFlight.accounting_entry_uuid.is_(None))
        stmt = select(ValidatedFlight).where(*filters).order_by(ValidatedFlight.jour.asc(), ValidatedFlight.takeoff_time.asc())
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def _preview_one(
        self,
        flight: ValidatedFlight,
        pack_balances: dict[tuple[UUID, str], Decimal],
        item_packs: dict[UUID, list[tuple[str, Decimal, int]]],
        club_info: _ClubBillingInfo | None = None,
    ) -> FlightBillingPreviewResponse:
        errors: list[FlightBillingError] = []
        warnings: list[FlightBillingError] = []

        club = club_info or _ClubBillingInfo(
            is_club_billed=False, charge_account_uuid=None, charge_account_code=None
        )

        # Resolve debit account — use club charge account for club billing, else 411
        debit_account: AccountingAccount | None = None
        if club.is_club_billed and club.charge_account_uuid:
            acct_result = await self.db.execute(
                select(AccountingAccount).where(AccountingAccount.uuid == club.charge_account_uuid)
            )
            debit_account = acct_result.scalar_one_or_none()
        if debit_account is None and not club.is_club_billed:
            debit_account = await self._get_receivable_account()
        if debit_account is None:
            errors.append(_error(
                "debit_account_missing",
                "Charge account not found for club billing." if club.is_club_billed
                else "Posting account 411 is not configured."
            ))

        payers = await self._resolve_payers(flight, errors, club=club)
        machines = [await self._resolve_machine("flight", flight.asset_code or flight.glider_erp_id, flight, errors, warnings)]
        if flight.launch_asset_code or flight.launch_machine_erp_id:
            machines.append(await self._resolve_machine("launch", flight.launch_asset_code or flight.launch_machine_erp_id, flight, errors, warnings))

        applied_lines: list[FlightBillingAppliedLinePreview] = []
        accounting_lines: list[FlightAccountingLinePreview] = []
        for machine in machines:
            if machine.asset is None or machine.version is None:
                continue
            for item in machine.items:
                quantity = _quantity_for_item(item, flight)
                if quantity is None:
                    errors.append(_error("quantity_missing", f"Quantity cannot be calculated for price item {item.name}.", scope=machine.source))
                    continue
                vi_credit = club.vi_analytical_credit_account
                if item.gl_account_credit is None and vi_credit is None:
                    errors.append(_error("pricing_item_account_missing", f"Price item {item.name} has no credit account.", scope=machine.source))
                    continue
                if not payers:
                    continue

                # ── Fixed price per duration bracket (e.g. TREUIL) ──────────────
                # Tier selection uses flight duration (minutes); the selected tier's
                # price is the TOTAL for the bracket, split by payer share.
                if item.unit == UNIT_FIXED_DURATION_TRANCHE:
                    fixed_tier = _select_tier(item, quantity)
                    fixed_price = _money(_dec(fixed_tier.price if fixed_tier else item.base_price))
                    for payer in payers:
                        if payer.share <= 0:
                            continue
                        amount = _money(fixed_price * payer.share)
                        eff_credit = vi_credit or item.gl_account_credit
                        preview_line = FlightBillingAppliedLinePreview(
                            source=machine.source,
                            payer_member_uuid=str(payer.member.uuid) if payer.member else None,
                            payer_member_account_id=payer.member.account_id if payer.member else None,
                            payer_role=payer.role,
                            pricing_version_uuid=str(machine.version.uuid),
                            pricing_item_uuid=str(item.uuid),
                            pricing_item_name=item.name,
                            asset_uuid=str(machine.asset.uuid),
                            asset_code=machine.asset.code,
                            unit=item.unit,
                            quantity=payer.share,
                            normal_unit_price=fixed_price,
                            applied_unit_price=fixed_price,
                            discount_reason=None,
                            amount=amount,
                            debit_account_uuid=str(debit_account.uuid) if debit_account else None,
                            debit_account_code=debit_account.code if debit_account else None,
                            credit_account_uuid=str(eff_credit.uuid) if eff_credit else None,
                            credit_account_code=eff_credit.code if eff_credit else None,
                            pack_hours_before=Decimal("0"),
                            pack_hours_used=Decimal("0"),
                            pack_hours_after=Decimal("0"),
                        )
                        applied_lines.append(preview_line)
                        accounting_lines.extend(
                            self._accounting_lines_for(preview_line, payer, machine.asset, debit_account, item, is_club_billed=club.is_club_billed, vi_credit_account=vi_credit)
                        )
                    continue

                # ── Per-unit pricing (existing logic) ────────────────────────────
                full_progressive_brackets = _progressive_split(item, quantity) if item.is_progressive else None
                for payer in payers:
                    payer_quantity = (quantity * payer.share).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
                    if payer_quantity <= 0:
                        continue
                    bracket_allocations = (
                        _split_progressive_brackets_by_share(full_progressive_brackets, payer.share)
                        if full_progressive_brackets is not None
                        else None
                    )
                    split_lines = self._price_for_payer(
                        item=item,
                        version=machine.version,
                        quantity=payer_quantity,
                        flight=flight,
                        payer=payer,
                        pack_balances=pack_balances,
                        item_packs=item_packs,
                        bracket_allocations=bracket_allocations,
                    )
                    for line_quantity, normal_unit_price, applied_unit_price, discount_reason, before, used, after in split_lines:
                        amount = _money(line_quantity * applied_unit_price)
                        eff_credit = vi_credit or item.gl_account_credit
                        preview_line = FlightBillingAppliedLinePreview(
                            source=machine.source,
                            payer_member_uuid=str(payer.member.uuid) if payer.member else None,
                            payer_member_account_id=payer.member.account_id if payer.member else None,
                            payer_role=payer.role,
                            pricing_version_uuid=str(machine.version.uuid),
                            pricing_item_uuid=str(item.uuid),
                            pricing_item_name=item.name,
                            asset_uuid=str(machine.asset.uuid),
                            asset_code=machine.asset.code,
                            unit=item.unit,
                            quantity=line_quantity,
                            normal_unit_price=normal_unit_price,
                            applied_unit_price=applied_unit_price,
                            discount_reason=discount_reason,
                            amount=amount,
                            debit_account_uuid=str(debit_account.uuid) if debit_account else None,
                            debit_account_code=debit_account.code if debit_account else None,
                            credit_account_uuid=str(eff_credit.uuid) if eff_credit else None,
                            credit_account_code=eff_credit.code if eff_credit else None,
                            pack_hours_before=before,
                            pack_hours_used=used,
                            pack_hours_after=after,
                        )
                        applied_lines.append(preview_line)
                        accounting_lines.extend(
                            self._accounting_lines_for(preview_line, payer, machine.asset, debit_account, item, is_club_billed=club.is_club_billed, vi_credit_account=vi_credit)
                        )

        total_amount = _money(sum((line.amount for line in applied_lines), Decimal("0")))
        billing_hash = self._billing_hash(applied_lines) if applied_lines else None
        return FlightBillingPreviewResponse(
            flight_uuid=str(flight.uuid),
            planche_uuid=flight.planche_uuid,
            flight_date=flight.jour,
            type_of_flight=flight.type_of_flight,
            type_label=FLIGHT_TYPE_LABELS.get(flight.type_of_flight),
            total_amount=total_amount,
            billing_hash=billing_hash,
            payers=[
                FlightBillingPayerPreview(
                    member_uuid=str(p.member.uuid) if p.member else None,
                    member_account_id=p.member.account_id if p.member else None,
                    member_name=_full_name(p.member) if p.member else ("Club" if club.is_club_billed else None),
                    role=p.role,
                    share=p.share,
                    reason=p.reason,
                )
                for p in payers
            ],
            applied_lines=applied_lines,
            accounting_lines=accounting_lines,
            errors=errors,
            warnings=warnings,
            can_apply=not any(error.blocking for error in errors),
            no_bill=bool(applied_lines) is False and not any(error.blocking for error in errors),
        )

    async def _get_receivable_account(self) -> AccountingAccount | None:
        result = await self.db.execute(
            select(AccountingAccount).where(
                AccountingAccount.code == "411",
                AccountingAccount.is_active.is_(True),
                AccountingAccount.is_posting_allowed.is_(True),
            )
        )
        account = result.scalars().first()
        if account is not None:
            return account
        result = await self.db.execute(
            select(AccountingAccount)
            .where(
                AccountingAccount.code.like("411%"),
                AccountingAccount.is_active.is_(True),
                AccountingAccount.is_posting_allowed.is_(True),
            )
            .order_by(AccountingAccount.code.asc())
        )
        return result.scalars().first()

    async def _resolve_member(self, value: str | None) -> Member | None:
        if not value:
            return None
        parsed = _parse_uuid(value)
        clauses = [Member.account_id == value, Member.legacy_account_id == value]
        if parsed is not None:
            clauses.append(Member.uuid == parsed)
        result = await self.db.execute(select(Member).where(or_(*clauses)))
        return result.scalars().first()

    async def _resolve_payers(
        self,
        flight: ValidatedFlight,
        errors: list[FlightBillingError],
        club: _ClubBillingInfo | None = None,
    ) -> list[_Payer]:
        club = club or _ClubBillingInfo(
            is_club_billed=False, charge_account_uuid=None, charge_account_code=None
        )

        # ── Club billing: charge_to_erp_id matches club member account_id ──
        if club.is_club_billed:
            return [_Payer(None, "club", Decimal("1"), "club_billing")]

        pilot = await self._resolve_member(flight.pilot_erp_id)
        second = await self._resolve_member(flight.second_pilot_erp_id or flight.second_pilot_id)
        charge_to = await self._resolve_member(flight.charge_to_erp_id or flight.charge_to_compta_id)
        flight_type = FLIGHT_TYPE_LABELS.get(flight.type_of_flight, "unknown")

        if flight_type in {"solo", "supervise", "lacher", "essai"}:
            if pilot is None:
                errors.append(_error("member_not_found", "Pilot payer cannot be resolved."))
                return []
            return [_Payer(pilot, "pilot", Decimal("1"), flight_type)]
        if flight_type == "instruction":
            if pilot is None:
                errors.append(_error("member_not_found", "Instruction pilot payer cannot be resolved."))
                return []
            if flight.instruction_split:
                if second is None:
                    errors.append(_error("payer_rule_missing_second_pilot", "Instruction split requires a second pilot."))
                    return []
                return [
                    _Payer(pilot, "pilot", Decimal("0.5"), "instruction_split"),
                    _Payer(second, "second", Decimal("0.5"), "instruction_split"),
                ]
            return [_Payer(pilot, "pilot", Decimal("1"), "instruction")]
        if flight_type == "partage":
            if pilot is None or second is None:
                errors.append(_error("payer_rule_missing_second_pilot", "Shared flight requires pilot and second pilot."))
                return []
            return [
                _Payer(pilot, "pilot", Decimal("0.5"), "partage"),
                _Payer(second, "second", Decimal("0.5"), "partage"),
            ]
        if flight_type == "passager":
            payer = charge_to or pilot
            if payer is None:
                errors.append(_error("member_not_found", "Passenger flight payer cannot be resolved."))
                return []
            role = "charge_to" if charge_to is not None else "pilot"
            return [_Payer(payer, role, Decimal("1"), "passager")]
        if flight_type == "initiation":
            # Initiation flight without club billing configuration
            errors.append(_error("club_billing_target_missing", "Initiation/VI club billing target is not configured."))
            return []

        if pilot is None:
            errors.append(_error("member_not_found", f"Payer cannot be resolved for flight type {flight.type_of_flight}."))
            return []
        return [_Payer(pilot, "pilot", Decimal("1"), "fallback_pilot")]

    async def _resolve_asset(self, value: str | None) -> Asset | None:
        if not value:
            return None
        parsed = _parse_uuid(value)
        clauses = [Asset.registration == value, Asset.code == value]
        if parsed is not None:
            clauses.append(Asset.uuid == parsed)
        result = await self.db.execute(select(Asset).where(or_(*clauses)))
        return result.scalars().first()

    def _flight_type_codes_for_machine(self, source: str, flight: ValidatedFlight, resolved_code: str | None = None) -> set[str]:
        # If a resolved code was found via launch_type lookup, use ONLY that (applies to both sources)
        if resolved_code:
            return {resolved_code}

        if source == "launch":
            # No specific launch_type mapping: fall back to defaults
            codes: set[str] = set()
            codes.update({"RMQ", "rmq", "remorque", "REMORQUE"})

            # 3. Add the flight type label as extra fallback
            flight_label = FLIGHT_TYPE_LABELS.get(flight.type_of_flight)
            if flight_label:
                codes.update({flight_label, flight_label.upper(), str(flight.type_of_flight)})

            return codes

        # For the glider: use the actual flight type only
        label = FLIGHT_TYPE_LABELS.get(flight.type_of_flight)
        if label is None:
            return {str(flight.type_of_flight)}
        return {label, label.upper(), str(flight.type_of_flight)}

    async def _flight_type_uuid_for_machine(self, source: str, flight: ValidatedFlight, resolved_code: str | None = None) -> UUID | None:
        candidates = self._flight_type_codes_for_machine(source, flight, resolved_code=resolved_code)
        result = await self.db.execute(select(FlightType).where(FlightType.code.in_(candidates)))
        flight_type = result.scalars().first()
        return flight_type.uuid if flight_type else None

    async def _resolve_machine(
        self,
        source: str,
        asset_value: str | None,
        flight: ValidatedFlight,
        errors: list[FlightBillingError],
        warnings: list[FlightBillingError],
    ) -> _PricedMachine:
        asset = await self._resolve_asset(asset_value)
        if asset is None:
            errors.append(_error("asset_not_found", f"{source.capitalize()} asset cannot be resolved from {asset_value!r}.", scope=source))
            return _PricedMachine(source, None, None, [])

        versions_result = await self.db.execute(
            select(PricingVersion)
            .where(
                PricingVersion.status == PRICING_STATUS_ACTIVE,
                PricingVersion.from_date <= flight.jour,
                or_(PricingVersion.to_date.is_(None), PricingVersion.to_date >= flight.jour),
                PricingVersion.asset_type_uuid == asset.asset_type_uuid,
            )
            .options(selectinload(PricingVersion.items).selectinload(PricingItem.tiers), selectinload(PricingVersion.items).selectinload(PricingItem.gl_account_credit))
        )
        versions = list(versions_result.scalars().unique().all())
        if not versions:
            if asset.ownership == 2:
                # Private aircraft may have no club pricing — non-blocking
                warnings.append(_error("pricing_version_missing", f"No active pricing version for private asset {asset.code} on {flight.jour}.", scope=source, blocking=False))
            else:
                errors.append(_error("pricing_version_missing", f"No active pricing version for {asset.code} on {flight.jour}.", scope=source))
            return _PricedMachine(source, asset, None, [])
        if len(versions) > 1:
            errors.append(_error("pricing_version_overlap", f"Multiple active pricing versions for {asset.code} on {flight.jour}.", scope=source))
            return _PricedMachine(source, asset, None, [])

        version = versions[0]
        # Resolve flight type via launch_type mapping.
        # Shifts avoid collisions across launch methods:
        #   Winch     (launch_method=1) → raw launch_type        (0,  1,  2…)
        #   Tow       (launch_method=2) → launch_type + 10      (10, 11, 12…)
        #   Autonome  (launch_method=3) → launch_type + 20      (20, 21, 22…)
        # Applies to source="launch" (separate launch machine) and source="flight" for
        # autonomous aircraft (launch_method=3) that act as their own propulsion.
        resolved_launch_code = None
        needs_launch_type_lookup = (
            source == "launch"
            or (source == "flight" and flight.launch_method == 3)
        )
        if needs_launch_type_lookup and flight.launch_type is not None and asset is not None:
            search_type = int(flight.launch_type)
            if flight.launch_method == 2:
                search_type += 10  # tow: +10
            elif flight.launch_method == 3:
                search_type += 20  # autonome: +20

            ft_result = await self.db.execute(
                select(FlightType).where(FlightType.launch_type == search_type)
            )
            ft = ft_result.scalar_one_or_none()
            if ft:
                resolved_launch_code = ft.code

        flight_type_uuid = await self._flight_type_uuid_for_machine(source, flight, resolved_code=resolved_launch_code)
        items = [item for item in version.items if item.flight_type_uuid is None or item.flight_type_uuid == flight_type_uuid]
        if not items:
            warnings.append(_error("pricing_item_missing", f"No price item applies to {asset.code}.", scope=source, blocking=False))
        return _PricedMachine(source, asset, version, items)

    async def _initial_pack_balances(self, flights: list[ValidatedFlight]) -> dict[tuple[UUID, str], Decimal]:
        """
        Load pack balances from vw_member_pack_balances for all members involved in the given flights.
        Returns dict keyed by (member_uuid, pack_type).
        """
        member_uuids: set[UUID] = set()
        for flight in flights:
            for value in [flight.pilot_erp_id, flight.second_pilot_erp_id, flight.charge_to_erp_id]:
                if value:
                    member = await self._resolve_member(value)
                    if member:
                        member_uuids.add(member.uuid)
        if not member_uuids:
            return {}
        result = await self.db.execute(
            text("SELECT member_uuid, pack_type, units_remaining FROM vw_member_pack_balances "
                 "WHERE member_uuid = ANY(:uuids) AND units_remaining > 0"),
            {"uuids": list(member_uuids)},
        )
        rows = result.fetchall()
        return {(row[0], row[1]): _dec(row[2]) for row in rows}

    async def _build_item_packs_map(self) -> dict[UUID, list[tuple[str, Decimal, int]]]:
        """
        Pre-load all pack applicability data.
        Returns item_uuid → [(pack_type, discounted_unit_price, priority)] sorted by priority ASC.
        """
        result = await self.db.execute(
            select(PackApplicability)
            .join(PackDefinition, PackDefinition.uuid == PackApplicability.pack_definition_uuid)
            .options(selectinload(PackApplicability.pack_definition))
        )
        rows = result.scalars().all()
        item_map: dict[UUID, list[tuple[str, Decimal, int]]] = {}
        for app in rows:
            pd = app.pack_definition
            item_map.setdefault(app.pricing_item_uuid, []).append(
                (pd.pack_type, app.discounted_unit_price, pd.priority)
            )
        # Sort by priority ASC so the first entry is the highest-priority pack
        for u in item_map:
            item_map[u].sort(key=lambda x: x[2])
        return item_map

    def _price_for_payer(
        self,
        *,
        item: PricingItem,
        version: PricingVersion,
        quantity: Decimal,
        flight: ValidatedFlight,
        payer: _Payer,
        pack_balances: dict[tuple[UUID, str], Decimal],
        item_packs: dict[UUID, list[tuple[str, Decimal, int]]],
        bracket_allocations: list[tuple[Decimal, Decimal]] | None = None,
    ) -> list[tuple[Decimal, Decimal, Decimal, str | None, Decimal | None, Decimal, Decimal | None]]:
        # ── Progressive mode: each bracket contributes its own portion ──────
        if item.is_progressive:
            return self._progressive_price_for_payer(
                item=item, version=version, quantity=quantity,
                flight=flight, payer=payer, pack_balances=pack_balances,
                item_packs=item_packs,
                bracket_allocations=bracket_allocations,
            )

        # ── Non-progressive (default): last applicable tier sets price for all ──
        tier = _select_tier(item, quantity)
        normal_price = _money(_dec(tier.price if tier else item.base_price))

        # ── Look up pack applicability for this item ──────────────────────────
        pack_type: str | None = None
        discounted_price: Decimal | None = None
        applicable_packs = item_packs.get(item.uuid, [])
        if version.use_pack and applicable_packs and payer.member and flight.jour and item.unit in PACK_CONSUMING_UNITS:
            for ptype, disc_price, _priority in applicable_packs:
                key = (payer.member.uuid, ptype)
                remaining = pack_balances.get(key, Decimal("0"))
                if remaining > 0:
                    pack_type = ptype
                    discounted_price = _money(disc_price)
                    break

        if pack_type is None or discounted_price is None:
            return [(quantity, normal_price, normal_price, None, None, Decimal("0"), None)]

        key = (payer.member.uuid, pack_type)
        before = pack_balances.get(key, Decimal("0"))
        if before <= 0:
            return [(quantity, normal_price, normal_price, None, before, Decimal("0"), before)]
        used = min(before, quantity)
        after = before - used

        # Track pack consumption for later REM adjustment, but bill at gross price
        pack_balances[key] = after
        result: list[tuple[Decimal, Decimal, Decimal, str | None, Decimal | None, Decimal, Decimal | None]] = []
        if used > 0:
            # applied_price = normal_price (gross billing), pack info tracked for REM
            result.append((used, normal_price, normal_price, "pack", before, used, after))
        remainder = quantity - used
        if remainder > 0:
            result.append((remainder, normal_price, normal_price, None, after, Decimal("0"), after))
        return result

    def _progressive_price_for_payer(
        self,
        *,
        item: PricingItem,
        version: PricingVersion,
        quantity: Decimal,
        flight: ValidatedFlight,
        payer: _Payer,
        pack_balances: dict[tuple[UUID, str], Decimal],
        item_packs: dict[UUID, list[tuple[str, Decimal, int]]],
        bracket_allocations: list[tuple[Decimal, Decimal]] | None = None,
    ) -> list[tuple[Decimal, Decimal, Decimal, str | None, Decimal | None, Decimal, Decimal | None]]:
        """Progressive bracket pricing — merged into a single consolidated line."""
        brackets = bracket_allocations if bracket_allocations is not None else _progressive_split(item, quantity)

        # ── Look up pack applicability for this item ──────────────────────────
        pack_type: str | None = None
        discounted_price: Decimal | None = None
        applicable_packs = item_packs.get(item.uuid, [])
        can_use_pack = bool(
            version.use_pack and applicable_packs
            and item.unit in PACK_CONSUMING_UNITS
            and payer.member and flight.jour
        )
        if can_use_pack:
            for ptype, disc_price, _priority in applicable_packs:
                key = (payer.member.uuid, ptype)
                remaining = pack_balances.get(key, Decimal("0"))
                if remaining > 0:
                    pack_type = ptype
                    discounted_price = _money(disc_price)
                    break
            can_use_pack = pack_type is not None and discounted_price is not None

        # Process brackets — bill at gross price, track pack consumption for REM
        raw_lines: list[tuple[Decimal, Decimal, str | None, Decimal | None, Decimal, Decimal, Decimal | None]] = []
        for bracket_qty, bracket_rate in brackets:
            normal_price = _money(bracket_rate)
            if can_use_pack:
                key = (payer.member.uuid, pack_type)
                before = pack_balances.get(key, Decimal("0"))
                if before > 0:
                    used = min(before, bracket_qty)
                    after = before - used
                    pack_balances[key] = after
                    # Use normal_price for billing, track pack info for later REM
                    raw_lines.append((used, normal_price, "pack", before, used, after, normal_price))
                    remainder = bracket_qty - used
                    if remainder > 0:
                        raw_lines.append((remainder, normal_price, None, after, Decimal("0"), after, normal_price))
                    continue
            raw_lines.append((bracket_qty, normal_price, None, None, Decimal("0"), None, normal_price))

        # Merge into a single line: weighted-average unit price
        if not raw_lines:
            return []
        total_qty = sum(line[0] for line in raw_lines)
        total_amount = sum(line[0] * line[1] for line in raw_lines)
        avg_price = _money(total_amount / total_qty) if total_qty > 0 else Decimal("0")

        # Consolidate pack fields: initial balance, total used, final balance
        initial_before = None
        total_used = Decimal("0")
        final_after = None
        discount_reason = None
        for qty, price, reason, p_before, p_used, p_after, _ in raw_lines:
            if reason == "pack":
                discount_reason = "pack"
                if initial_before is None:
                    initial_before = p_before
                total_used += p_used or Decimal("0")
                final_after = p_after

        return [(total_qty, avg_price, avg_price, discount_reason, initial_before, total_used, final_after)]

    def _accounting_lines_for(
        self,
        line: FlightBillingAppliedLinePreview,
        payer: _Payer,
        asset: Asset,
        debit_account: AccountingAccount | None,
        item: PricingItem,
        is_club_billed: bool = False,
        vi_credit_account: AccountingAccount | None = None,
    ) -> list[FlightAccountingLinePreview]:
        description = f"{line.pricing_item_name} {line.asset_code}"
        asset_uuid = str(asset.uuid)

        if vi_credit_account is not None:
            # VI analytical mode: D 921 tiers=asset / C 902 tiers=None
            debit_tiers_uuid = asset_uuid
            credit_account = vi_credit_account
            credit_tiers_uuid = None
        else:
            # Standard mode: D debit_account tiers=member (or None if club) / C 7xx tiers=asset
            debit_tiers_uuid = None if is_club_billed else (str(payer.member.uuid) if payer.member else None)
            credit_account = item.gl_account_credit
            credit_tiers_uuid = asset_uuid

        return [
            FlightAccountingLinePreview(
                side="debit",
                account_uuid=str(debit_account.uuid) if debit_account else None,
                account_code=debit_account.code if debit_account else None,
                tiers_uuid=debit_tiers_uuid,
                debit=line.amount,
                credit=Decimal("0"),
                description=description,
            ),
            FlightAccountingLinePreview(
                side="credit",
                account_uuid=str(credit_account.uuid) if credit_account else None,
                account_code=credit_account.code if credit_account else None,
                tiers_uuid=credit_tiers_uuid,
                debit=Decimal("0"),
                credit=line.amount,
                description=description,
            ),
        ]

    def _billing_hash(self, lines: list[FlightBillingAppliedLinePreview]) -> str:
        payload = [
            {
                "source": line.source,
                "payer": line.payer_member_uuid,
                "item": line.pricing_item_uuid,
                "asset": line.asset_uuid,
                "quantity": str(line.quantity),
                "unit_price": str(line.applied_unit_price),
                "amount": str(line.amount),
                "debit": line.debit_account_uuid,
                "credit": line.credit_account_uuid,
                "discount": line.discount_reason,
                "pack_hours_used": str(line.pack_hours_used),
            }
            for line in lines
        ]
        payload.sort(key=lambda item: json.dumps(item, sort_keys=True))
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
