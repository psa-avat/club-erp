"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Cheque receipt + remittance (remise de chèque) schemas
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
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ChequeCandidateResponse(BaseModel):
    """A previously-recorded cheque-receipt entry eligible for a remittance."""
    entry_uuid: UUID
    fiscal_year_uuid: UUID
    entry_date: date
    description: str
    state: int  # 1=Draft, 2=Posted
    account_code: str
    tiers_display_ref: Optional[str] = None
    tiers_display_name: Optional[str] = None
    amount: Decimal = Field(decimal_places=4)


class ChequeRemittanceCreateRequest(BaseModel):
    """Request to generate a deposit entry for a batch of previously-received cheques."""
    fiscal_year_uuid: UUID
    remittance_date: date
    entry_uuids: list[UUID] = Field(min_length=1)


class ChequeRemittanceResponse(BaseModel):
    """A generated remittance batch."""
    uuid: UUID
    fiscal_year_uuid: UUID
    remittance_date: date
    deposit_entry_uuid: UUID
    total_amount: Decimal = Field(decimal_places=4)
    entry_count: int
    created_at: datetime

    class Config:
        from_attributes = True
