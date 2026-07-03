"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation module routes
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
import io
import json
import logging
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_MANAGE_SYSTEM_SETTINGS, CAP_POST_ACCOUNTING_ENTRIES, CAP_VIEW_FINANCIALS
from models import User
from schemas.reconciliation import (
    BankCsvMappingCreateRequest,
    BankCsvMappingResponse,
    BankStatementListResponse,
    BankStatementLineListResponse,
    BankStatementLineResponse,
    BankStatementResponse,
    DiscrepancyResponse,
    ManualMatchRequest,
    MatchResultResponse,
    ReconciliationReportResponse,
    ResolveDiscrepancyRequest,
    UnmatchRequest,
)
from services.bank_parsers import import_statement
from services.bank_reconciliation import (
    close_reconciliation,
    create_csv_mapping,
    delete_csv_mapping,
    delete_statement,
    detect_discrepancies,
    get_reconciliation_report,
    get_statement,
    list_csv_mappings,
    list_statement_lines,
    list_statements,
    manual_match,
    resolve_discrepancy,
    run_auto_match,
    unmatch as unmatch_line,
)

router = APIRouter(prefix="/api/v1/reconciliation", tags=["accounting", "reconciliation"])
logger = logging.getLogger(__name__)

view_guard = Depends(require_capability(CAP_VIEW_FINANCIALS))
post_guard = Depends(require_capability(CAP_POST_ACCOUNTING_ENTRIES))
settings_guard = Depends(require_capability(CAP_MANAGE_SYSTEM_SETTINGS))


# ---------------------------------------------------------------------------
# Import & statements
# ---------------------------------------------------------------------------

@router.post("/import", response_model=BankStatementResponse, status_code=status.HTTP_201_CREATED)
async def import_statement_endpoint(
    file: UploadFile = File(...),
    fiscal_year_uuid: UUID = Form(...),
    journal_uuid: UUID = Form(...),
    account_uuid: UUID = Form(...),
    csv_mapping_uuid: UUID | None = Form(None),
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    content = await file.read()
    return await import_statement(
        db,
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=journal_uuid,
        account_uuid=account_uuid,
        file_content=content,
        filename=file.filename or "statement",
        user_id=current_user.id,
        csv_mapping_uuid=csv_mapping_uuid,
    )


@router.get("/statements", response_model=BankStatementListResponse)
async def list_statements_endpoint(
    fiscal_year_uuid: UUID | None = Query(None),
    journal_uuid: UUID | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    items = await list_statements(
        db, fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid, status_filter=status_filter
    )
    return BankStatementListResponse(items=items, total=len(items))


@router.get("/statements/{statement_uuid}", response_model=BankStatementResponse)
async def get_statement_endpoint(
    statement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    return await get_statement(db, statement_uuid)


@router.delete("/statements/{statement_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_statement_endpoint(
    statement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
):
    await delete_statement(db, statement_uuid)


@router.get("/statements/{statement_uuid}/lines", response_model=BankStatementLineListResponse)
async def list_statement_lines_endpoint(
    statement_uuid: UUID,
    description: str | None = Query(None),
    match_status: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    amount_min: Decimal | None = Query(None),
    amount_max: Decimal | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    items, total = await list_statement_lines(
        db,
        statement_uuid,
        description=description,
        match_status=match_status,
        date_from=date_from,
        date_to=date_to,
        amount_min=amount_min,
        amount_max=amount_max,
        limit=limit,
        offset=offset,
    )
    return BankStatementLineListResponse(items=items, total=total)


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

@router.post("/statements/{statement_uuid}/match", response_model=MatchResultResponse)
async def run_auto_match_endpoint(
    statement_uuid: UUID,
    include_drafts: bool = Query(True, description="Also consider Draft (unposted) entries as match candidates"),
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
):
    return await run_auto_match(db, statement_uuid, include_drafts=include_drafts)


@router.post("/manual-match", response_model=BankStatementLineResponse)
async def manual_match_endpoint(
    payload: ManualMatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    return await manual_match(
        db, payload.line_uuid, payload.entry_uuid, payload.fiscal_year_uuid, current_user.id,
        include_drafts=payload.include_drafts,
    )


@router.post("/unmatch", response_model=BankStatementLineResponse)
async def unmatch_endpoint(
    payload: UnmatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
):
    return await unmatch_line(db, payload.line_uuid, payload.reason)


# ---------------------------------------------------------------------------
# Discrepancies & closure
# ---------------------------------------------------------------------------

@router.get("/statements/{statement_uuid}/discrepancies", response_model=list[DiscrepancyResponse])
async def list_discrepancies_endpoint(
    statement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    return await detect_discrepancies(db, statement_uuid)


@router.post("/resolve-discrepancy", response_model=BankStatementLineResponse)
async def resolve_discrepancy_endpoint(
    payload: ResolveDiscrepancyRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    return await resolve_discrepancy(
        db,
        payload.line_uuid,
        payload.action,
        current_user.id,
        counter_account_uuid=payload.counter_account_uuid,
        notes=payload.notes,
    )


@router.post("/statements/{statement_uuid}/close", response_model=BankStatementResponse)
async def close_reconciliation_endpoint(
    statement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    return await close_reconciliation(db, statement_uuid, current_user.id)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

@router.get("/statements/{statement_uuid}/report", response_model=ReconciliationReportResponse)
async def get_report_endpoint(
    statement_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    return await get_reconciliation_report(db, statement_uuid)


@router.get("/statements/{statement_uuid}/report/download")
async def download_report_endpoint(
    statement_uuid: UUID,
    format: str = Query("json"),
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """Force-download the reconciliation report. v1: JSON only, v2: PDF."""
    statement = await get_statement(db, statement_uuid)
    report_data = await get_reconciliation_report(db, statement_uuid)
    filename = f"rapprochement_{statement.statement_date.strftime('%Y%m%d')}"

    if format == "json":
        return StreamingResponse(
            io.BytesIO(json.dumps(report_data, default=str).encode()),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={filename}.json"},
        )
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported report format for v1")


# ---------------------------------------------------------------------------
# CSV mappings
# ---------------------------------------------------------------------------

@router.get("/csv-mappings", response_model=list[BankCsvMappingResponse])
async def list_csv_mappings_endpoint(
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    return await list_csv_mappings(db)


@router.post("/csv-mappings", response_model=BankCsvMappingResponse, status_code=status.HTTP_201_CREATED)
async def create_csv_mapping_endpoint(
    payload: BankCsvMappingCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
    current_user: User = Depends(get_current_user),
):
    return await create_csv_mapping(
        db,
        name=payload.name,
        column_mapping=payload.column_mapping,
        separator=payload.separator,
        encoding=payload.encoding,
        date_format=payload.date_format,
        user_id=current_user.id,
    )


@router.delete("/csv-mappings/{mapping_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_csv_mapping_endpoint(
    mapping_uuid: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = settings_guard,
):
    await delete_csv_mapping(db, mapping_uuid)
