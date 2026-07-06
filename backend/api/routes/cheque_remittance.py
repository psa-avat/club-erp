"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Cheque receipt + remittance (remise de chèque) routes
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
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from api.security import get_current_user, require_capability
from constants import CAP_POST_ACCOUNTING_ENTRIES, CAP_VIEW_FINANCIALS
from models import User
from schemas.cheque_remittance import ChequeCandidateResponse, ChequeRemittanceCreateRequest, ChequeRemittanceResponse
from services.cheque_remittance import create_cheque_remittance, list_cheque_candidates

router = APIRouter(prefix="/api/v1/cheque-remittances", tags=["accounting", "cheque-remittances"])

view_guard = Depends(require_capability(CAP_VIEW_FINANCIALS))
post_guard = Depends(require_capability(CAP_POST_ACCOUNTING_ENTRIES))


@router.get("/candidates", response_model=list[ChequeCandidateResponse])
async def list_cheque_candidates_endpoint(
    fiscal_year_uuid: UUID,
    include_drafts: bool = True,
    db: AsyncSession = Depends(get_db),
    _: User = view_guard,
):
    """List cheque-receipt entries available for a new remittance."""
    return await list_cheque_candidates(db, fiscal_year_uuid, include_drafts=include_drafts)


@router.post("", response_model=ChequeRemittanceResponse, status_code=status.HTTP_201_CREATED)
async def create_cheque_remittance_endpoint(
    request: ChequeRemittanceCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = post_guard,
    current_user: User = Depends(get_current_user),
):
    """Generate the deposit entry for a batch of previously-recorded cheques."""
    remittance = await create_cheque_remittance(db, request, current_user.id)
    return ChequeRemittanceResponse(
        uuid=remittance.uuid,
        fiscal_year_uuid=remittance.fiscal_year_uuid,
        remittance_date=remittance.remittance_date,
        deposit_entry_uuid=remittance.deposit_entry_uuid,
        total_amount=remittance.total_amount,
        entry_count=len(remittance.lines),
        created_at=remittance.created_at,
    )
