"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation: statement parsers (OFX/QFX, CSV) and import
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

import csv
import hashlib
import io
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID

import chardet
from fastapi import HTTPException, status
from ofxparse import OfxParser as _OfxParser
from ofxparse.ofxparse import OfxParserException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import BankCsvMapping, BankStatement, BankStatementLine
from services.accounting import get_account, get_journal, validate_fiscal_year_open

logger = logging.getLogger(__name__)

SUPPORTED_V1_FORMATS = ("ofx", "qfx", "csv")


@dataclass
class ParsedLine:
    line_date: date
    description: str
    amount: Decimal  # positive = credit, negative = debit
    reference: str = ""
    counterparty: str = ""
    fit_id: str | None = None
    raw_data: dict | None = None


@dataclass
class ParsedStatement:
    account_id: str | None
    period_start: date | None
    period_end: date | None
    opening_balance: Decimal | None
    closing_balance: Decimal | None
    raw_format: str
    lines: list[ParsedLine] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def detect_format(filename: str, content: bytes) -> str:
    """Detect the statement format from filename extension, falling back to content sniffing.

    V1: .ofx/.qfx -> 'ofx', .csv -> 'csv'. QIF/MT940 are v2 and not recognized here.
    """
    lower = (filename or "").lower()
    if lower.endswith(".ofx") or lower.endswith(".qfx"):
        return "ofx"
    if lower.endswith(".csv"):
        return "csv"

    head = content[:1024].lstrip()
    if head.upper().startswith(b"OFXHEADER") or b"<OFX>" in head.upper():
        return "ofx"

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unable to detect statement format for {filename!r}. Supported in v1: .ofx, .qfx, .csv",
    )


class OfxParser:
    """Parses OFX 1.x (SGML) and 2.x (XML) bank/credit-card statements via ofxparse.

    FITID values are used to deduplicate transactions when present. Per-transaction
    parsing errors are collected as warnings (fail_fast=False) rather than aborting
    the whole import.
    """

    @staticmethod
    def parse(content: bytes) -> ParsedStatement:
        try:
            ofx = _OfxParser.parse(io.BytesIO(content), fail_fast=False)
        except OfxParserException as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid OFX file: {exc}",
            ) from exc

        if not ofx.accounts:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OFX file has no account statement")

        account = ofx.accounts[0]
        statement = account.statement

        warnings: list[str] = []
        for discarded in getattr(statement, "discarded_entries", []) or []:
            warnings.append(f"Discarded transaction: {discarded}")
        for warn in getattr(statement, "warnings", []) or []:
            warnings.append(str(warn))

        seen_fit_ids: set[str] = set()
        lines: list[ParsedLine] = []
        for txn in statement.transactions:
            fit_id = (txn.id or "").strip() or None
            if fit_id:
                if fit_id in seen_fit_ids:
                    warnings.append(f"Duplicate FITID skipped: {fit_id}")
                    continue
                seen_fit_ids.add(fit_id)

            txn_date = txn.date.date() if isinstance(txn.date, datetime) else txn.date
            if txn_date is None:
                warnings.append(f"Transaction without a date skipped (memo={txn.memo!r})")
                continue

            try:
                amount = Decimal(str(txn.amount))
            except (InvalidOperation, TypeError):
                warnings.append(f"Transaction with invalid amount skipped (memo={txn.memo!r})")
                continue

            lines.append(
                ParsedLine(
                    line_date=txn_date,
                    description=(txn.memo or txn.payee or "").strip(),
                    amount=amount,
                    reference=(txn.checknum or "").strip(),
                    counterparty=(txn.payee or "").strip(),
                    fit_id=fit_id,
                    raw_data={
                        "fit_id": fit_id,
                        "type": txn.type,
                        "payee": txn.payee,
                        "memo": txn.memo,
                        "checknum": txn.checknum,
                    },
                )
            )

        period_start = statement.start_date.date() if isinstance(statement.start_date, datetime) else (statement.start_date or None)
        period_end = statement.end_date.date() if isinstance(statement.end_date, datetime) else (statement.end_date or None)

        return ParsedStatement(
            account_id=account.account_id or None,
            period_start=period_start,
            period_end=period_end,
            opening_balance=None,  # OFX only exposes the closing (ledger) balance
            closing_balance=getattr(statement, "balance", None),
            raw_format="ofx",
            lines=lines,
            warnings=warnings,
        )


_DECIMAL_FR_SEPARATORS = str.maketrans({".": "", ",": "."})


def _parse_amount(raw: str) -> Decimal:
    raw = (raw or "").strip().replace(" ", "").replace(" ", "")
    if not raw:
        raise ValueError("empty amount")
    if "," in raw and "." in raw:
        # French thousands separator + decimal comma, e.g. "1.234,56"
        raw = raw.translate(_DECIMAL_FR_SEPARATORS)
    elif "," in raw:
        # Ambiguous single comma: treat as decimal separator (French convention)
        raw = raw.replace(",", ".")
    return Decimal(raw)


def _parse_mapped_date(raw: str, date_format: str) -> date:
    raw = (raw or "").strip()
    py_format = (
        date_format.replace("YYYY", "%Y").replace("MM", "%m").replace("DD", "%d")
    )
    return datetime.strptime(raw, py_format).date()


class CsvParser:
    """Parses a mapped CSV bank/cash statement using a saved BankCsvMapping.

    Separator is auto-detected among comma/semicolon/tab, encoding via chardet.
    date_format is read explicitly from the mapping to avoid day/month inversion.
    """

    @staticmethod
    def parse(content: bytes, mapping: BankCsvMapping) -> ParsedStatement:
        encoding = mapping.encoding or (chardet.detect(content).get("encoding") or "utf-8")
        try:
            text = content.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            text = content.decode("utf-8", errors="replace")
        text = text.lstrip("﻿")

        separator = mapping.separator
        if not separator:
            sample = text[:4096]
            try:
                separator = csv.Sniffer().sniff(sample, delimiters=",;\t").delimiter
            except csv.Error:
                separator = ";"

        reader = csv.DictReader(io.StringIO(text), delimiter=separator)
        column_mapping: dict = mapping.column_mapping or {}
        date_col = column_mapping.get("date")
        description_col = column_mapping.get("description")
        amount_col = column_mapping.get("amount")
        debit_col = column_mapping.get("debit")
        credit_col = column_mapping.get("credit")
        reference_col = column_mapping.get("reference")
        counterparty_col = column_mapping.get("counterparty")

        if not date_col or not (amount_col or (debit_col and credit_col)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CSV mapping must define a date column and either an amount column or debit+credit columns",
            )

        warnings: list[str] = []
        lines: list[ParsedLine] = []
        for idx, row in enumerate(reader, start=1):
            raw_date = row.get(date_col, "")
            try:
                line_date = _parse_mapped_date(raw_date, mapping.date_format)
            except ValueError:
                warnings.append(f"Row {idx}: invalid date {raw_date!r} for format {mapping.date_format}")
                continue

            try:
                if amount_col:
                    amount = _parse_amount(row.get(amount_col, ""))
                else:
                    debit = _parse_amount(row.get(debit_col, "") or "0")
                    credit = _parse_amount(row.get(credit_col, "") or "0")
                    amount = credit - debit
            except (InvalidOperation, ValueError):
                warnings.append(f"Row {idx}: invalid amount")
                continue

            lines.append(
                ParsedLine(
                    line_date=line_date,
                    description=(row.get(description_col, "") if description_col else "").strip(),
                    amount=amount,
                    reference=(row.get(reference_col, "") if reference_col else "").strip(),
                    counterparty=(row.get(counterparty_col, "") if counterparty_col else "").strip(),
                    raw_data=dict(row),
                )
            )

        if not lines:
            warnings.append("No valid lines parsed from CSV")

        period_start = min((l.line_date for l in lines), default=None)
        period_end = max((l.line_date for l in lines), default=None)

        return ParsedStatement(
            account_id=None,
            period_start=period_start,
            period_end=period_end,
            opening_balance=None,
            closing_balance=None,
            raw_format="csv",
            lines=lines,
            warnings=warnings,
        )


class QifParser:
    """V2: !Type:Bank + D/T/M/P fields -> ParsedLine. Not implemented in the v1 MVP."""


class Mt940Parser:
    """V2: SWIFT :61: (amount/date) and :86: (description) fields -> ParsedLine. Not implemented in the v1 MVP."""


async def _get_csv_mapping(db: AsyncSession, csv_mapping_uuid: UUID) -> BankCsvMapping:
    mapping = await db.get(BankCsvMapping, csv_mapping_uuid)
    if not mapping:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"CSV mapping {csv_mapping_uuid} not found")
    return mapping


async def import_statement(
    db: AsyncSession,
    *,
    fiscal_year_uuid: UUID,
    journal_uuid: UUID,
    account_uuid: UUID,
    file_content: bytes,
    filename: str,
    user_id: int,
    csv_mapping_uuid: UUID | None = None,
) -> BankStatement:
    """Import a bank/cash statement file into bank_statements + bank_statement_lines.

    1. journal.type must be 3 (Banque) or 4 (Caisse).
    2. account.is_reconcilable and account.is_active must be true.
    3. If journal.default_account_uuid is set, account_uuid must match it (v1: refuse otherwise).
    4. Detect format (v1: ofx/qfx/csv only).
    5. Parse into a ParsedStatement (CsvParser needs a BankCsvMapping for column/date_format).
    6. Reject duplicate imports by SHA-256 of the raw content.
    7. Persist BankStatement + BankStatementLine rows.
    8. Warn (non-blocking) if opening + credits - debits doesn't reconcile with closing.
    """
    await validate_fiscal_year_open(db, fiscal_year_uuid)
    journal = await get_journal(db, journal_uuid)
    account = await get_account(db, account_uuid)

    if journal.type not in (3, 4):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Journal {journal.code} is not a Banque/Caisse journal (type={journal.type})",
        )
    if not account.is_reconcilable or not account.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account {account.code} is not an active, reconcilable account",
        )
    if journal.default_account_uuid and journal.default_account_uuid != account.uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account {account.code} is not the default account of journal {journal.code}",
        )

    content_hash = hashlib.sha256(file_content).hexdigest()
    existing = await db.scalar(select(BankStatement).where(BankStatement.raw_content_hash == content_hash))
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This statement was already imported on {existing.import_date} (statement {existing.uuid})",
        )

    source_format = detect_format(filename, file_content)
    if source_format == "ofx":
        parsed = OfxParser.parse(file_content)
    elif source_format == "csv":
        if not csv_mapping_uuid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="csv_mapping_uuid is required to import a CSV statement",
            )
        mapping = await _get_csv_mapping(db, csv_mapping_uuid)
        parsed = CsvParser.parse(file_content, mapping)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported statement format in v1: {source_format}",
        )

    if not parsed.lines:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No transactions could be parsed from this file")

    total_debits = sum((-l.amount for l in parsed.lines if l.amount < 0), Decimal("0"))
    total_credits = sum((l.amount for l in parsed.lines if l.amount > 0), Decimal("0"))

    opening_balance = parsed.opening_balance
    closing_balance = parsed.closing_balance
    if opening_balance is not None and closing_balance is not None:
        expected_closing = opening_balance + total_credits - total_debits
        if abs(expected_closing - closing_balance) > Decimal("0.01"):
            parsed.warnings.append(
                f"Balance mismatch: opening {opening_balance} + credits {total_credits} - debits {total_debits} "
                f"= {expected_closing}, expected closing {closing_balance}"
            )
    elif opening_balance is None and closing_balance is not None:
        # OFX only exposes the ledger (closing) balance — derive the opening balance
        # from it so close_reconciliation's balance check has a correct baseline.
        opening_balance = closing_balance - total_credits + total_debits

    statement_date = parsed.period_end or date.today()

    statement = BankStatement(
        fiscal_year_uuid=fiscal_year_uuid,
        journal_uuid=journal_uuid,
        account_uuid=account_uuid,
        statement_date=statement_date,
        statement_period_start=parsed.period_start,
        statement_period_end=parsed.period_end,
        source_format=source_format,
        raw_filename=filename,
        raw_content_hash=content_hash,
        opening_balance=opening_balance or Decimal("0"),
        closing_balance=closing_balance if closing_balance is not None else (opening_balance or Decimal("0")) + total_credits - total_debits,
        total_debits=total_debits,
        total_credits=total_credits,
        line_count=len(parsed.lines),
        status="imported",
        created_by=user_id,
    )

    for idx, line in enumerate(parsed.lines):
        statement.lines.append(
            BankStatementLine(
                line_index=idx,
                line_date=line.line_date,
                description=line.description or None,
                amount=line.amount,
                reference=line.reference or None,
                counterparty=line.counterparty or None,
                bank_raw_data=line.raw_data,
                match_status="unmatched",
            )
        )

    db.add(statement)
    await db.commit()
    await db.refresh(statement, ["lines"])
    return statement
