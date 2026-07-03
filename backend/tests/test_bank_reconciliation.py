"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - bank reconciliation tests: parsers, matching engine, discrepancies, closure
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

from datetime import date
from decimal import Decimal
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from models import AccountingAccount, AccountingEntry, AccountingJournal, AccountingLine, BankCsvMapping, BankStatement, BankStatementLine
from services.bank_parsers import CsvParser, OfxParser, detect_format, import_statement
from services.bank_reconciliation import (
    _entry_bank_line,
    _is_internal_transfer_candidate,
    _score_candidate,
    close_reconciliation,
    detect_discrepancies,
    manual_match,
    run_auto_match,
    unmatch,
)

_OFX_SAMPLE = """OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>EUR
<BANKACCTFROM>
<BANKID>12345
<ACCTID>00012345678
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260601
<DTEND>20260630
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260603
<TRNAMT>1000.00
<FITID>FIT001
<NAME>Virement Dupont
<MEMO>Cotisation
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260603
<TRNAMT>1000.00
<FITID>FIT001
<NAME>Virement Dupont
<MEMO>Cotisation
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260605
<TRNAMT>-52.30
<FITID>FIT002
<NAME>Frais bancaires
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>4197.70
<DTASOF>20260630
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
"""


class _FakeScalarsResult:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values

    def unique(self):
        return self


class _FakeExecuteResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return _FakeScalarsResult(self._values)


def _bank_account(**overrides):
    defaults = dict(
        uuid=uuid4(), code="512100", name="Banque", type=1, normal_balance=1,
        is_reconcilable=True, is_active=True,
    )
    defaults.update(overrides)
    return AccountingAccount(**defaults)


def _journal(**overrides):
    defaults = dict(uuid=uuid4(), code="BQ", name="Banque", type=3, is_active=True)
    defaults.update(overrides)
    return AccountingJournal(**defaults)


def _entry_with_bank_line(account_uuid, *, debit=Decimal("0"), credit=Decimal("0"), entry_date=date(2026, 6, 3),
                           other_account: AccountingAccount | None = None, reference=None, description=None):
    fiscal_year_uuid = uuid4()
    entry_uuid = uuid4()
    entry = AccountingEntry(
        uuid=entry_uuid, fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(),
        entry_date=entry_date, description=description or "Test entry", reference=reference,
        state=2,
    )
    bank_line = AccountingLine(
        uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
        account_uuid=account_uuid, debit=debit, credit=credit,
    )
    bank_line.account = _bank_account(uuid=account_uuid)
    lines = [bank_line]
    if other_account is not None:
        other_line = AccountingLine(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
            account_uuid=other_account.uuid,
            debit=credit, credit=debit,
        )
        other_line.account = other_account
        lines.append(other_line)
    entry.lines = lines
    return entry


class DetectFormatTests(IsolatedAsyncioTestCase):
    def test_detects_ofx_by_extension(self):
        self.assertEqual(detect_format("releve.ofx", b""), "ofx")

    def test_detects_qfx_by_extension(self):
        self.assertEqual(detect_format("releve.qfx", b""), "ofx")

    def test_detects_csv_by_extension(self):
        self.assertEqual(detect_format("releve.csv", b"date;amount"), "csv")

    def test_unknown_extension_raises_400(self):
        with self.assertRaises(HTTPException) as ctx:
            detect_format("releve.qif", b"!Type:Bank")
        self.assertEqual(ctx.exception.status_code, 400)


class OfxParserTests(IsolatedAsyncioTestCase):
    def test_parses_lines_and_dedupes_fitid(self):
        parsed = OfxParser.parse(_OFX_SAMPLE.encode())

        self.assertEqual(len(parsed.lines), 2)  # duplicate FIT001 skipped
        self.assertTrue(any("Duplicate FITID" in w for w in parsed.warnings))
        self.assertEqual(parsed.account_id, "00012345678")
        self.assertEqual(parsed.closing_balance, Decimal("4197.70"))

        first = parsed.lines[0]
        self.assertEqual(first.amount, Decimal("1000.00"))
        self.assertEqual(first.line_date, date(2026, 6, 3))
        self.assertEqual(first.description, "Cotisation")

        second = parsed.lines[1]
        self.assertEqual(second.amount, Decimal("-52.30"))
        self.assertEqual(second.counterparty, "Frais bancaires")


class CsvParserTests(IsolatedAsyncioTestCase):
    def _mapping(self, date_format="DD/MM/YYYY", separator=";"):
        return BankCsvMapping(
            uuid=uuid4(), name="test", created_by=1,
            column_mapping={"date": "Date", "description": "Libelle", "amount": "Montant", "reference": "Ref"},
            separator=separator, encoding="utf-8", date_format=date_format,
        )

    def test_dd_mm_yyyy_does_not_invert_day_and_month(self):
        content = "Date;Libelle;Montant;Ref\n03/06/2026;Cotisation;1000,00;REF1\n".encode()
        parsed = CsvParser.parse(content, self._mapping(date_format="DD/MM/YYYY"))

        self.assertEqual(len(parsed.lines), 1)
        self.assertEqual(parsed.lines[0].line_date, date(2026, 6, 3))
        self.assertEqual(parsed.lines[0].amount, Decimal("1000.00"))

    def test_mm_dd_yyyy_is_interpreted_correctly(self):
        content = "Date;Libelle;Montant;Ref\n06/03/2026;Cotisation;1000.00;REF1\n".encode()
        parsed = CsvParser.parse(content, self._mapping(date_format="MM/DD/YYYY"))

        self.assertEqual(len(parsed.lines), 1)
        self.assertEqual(parsed.lines[0].line_date, date(2026, 6, 3))

    def test_french_thousands_and_decimal_separators(self):
        content = "Date;Libelle;Montant;Ref\n03/06/2026;Gros virement;1.234,56;REF1\n".encode()
        parsed = CsvParser.parse(content, self._mapping())

        self.assertEqual(parsed.lines[0].amount, Decimal("1234.56"))

    def test_invalid_row_is_skipped_with_warning(self):
        content = "Date;Libelle;Montant;Ref\nnotadate;Cotisation;1000,00;REF1\n".encode()
        parsed = CsvParser.parse(content, self._mapping())

        self.assertEqual(parsed.lines, [])
        self.assertTrue(any("invalid date" in w for w in parsed.warnings))


class ScoringHelperTests(IsolatedAsyncioTestCase):
    def test_exact_reference_and_date_scores_perfect(self):
        self.assertEqual(_score_candidate(0, True), Decimal("1.000"))
        self.assertEqual(_score_candidate(1, True), Decimal("1.000"))

    def test_exact_date_without_reference_scores_high(self):
        self.assertEqual(_score_candidate(0, False), Decimal("0.950"))

    def test_within_three_days_scores_auto_accept(self):
        self.assertEqual(_score_candidate(3, False), Decimal("0.850"))

    def test_far_date_scores_below_auto_accept_threshold(self):
        self.assertEqual(_score_candidate(7, False), Decimal("0.600"))
        self.assertEqual(_score_candidate(10, False), Decimal("0.500"))
        self.assertEqual(_score_candidate(45, False), Decimal("0.400"))

    def test_entry_bank_line_finds_matching_account(self):
        account_uuid = uuid4()
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("100"))
        line = _entry_bank_line(entry, account_uuid)
        self.assertIsNotNone(line)
        self.assertEqual(line.account_uuid, account_uuid)

    def test_internal_transfer_detected_via_other_reconcilable_account(self):
        account_uuid = uuid4()
        caisse = _bank_account(code="531", type=1, is_reconcilable=True)
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("100"), other_account=caisse)
        bank_line = _entry_bank_line(entry, account_uuid)
        self.assertTrue(_is_internal_transfer_candidate(entry, bank_line))

    def test_not_internal_transfer_when_other_side_is_not_reconcilable(self):
        account_uuid = uuid4()
        member_account = _bank_account(code="411", type=1, is_reconcilable=False)
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("100"), other_account=member_account)
        bank_line = _entry_bank_line(entry, account_uuid)
        self.assertFalse(_is_internal_transfer_candidate(entry, bank_line))


class ImportStatementValidationTests(IsolatedAsyncioTestCase):
    async def test_rejects_non_bank_caisse_journal(self):
        journal = _journal(type=1)  # Sale journal
        account = _bank_account()
        db = AsyncMock()

        with patch("services.bank_parsers.validate_fiscal_year_open", new=AsyncMock()), \
             patch("services.bank_parsers.get_journal", new=AsyncMock(return_value=journal)), \
             patch("services.bank_parsers.get_account", new=AsyncMock(return_value=account)):
            with self.assertRaises(HTTPException) as ctx:
                await import_statement(
                    db, fiscal_year_uuid=uuid4(), journal_uuid=journal.uuid, account_uuid=account.uuid,
                    file_content=b"x", filename="r.ofx", user_id=1,
                )
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_rejects_non_reconcilable_account(self):
        journal = _journal(type=3)
        account = _bank_account(is_reconcilable=False)
        db = AsyncMock()

        with patch("services.bank_parsers.validate_fiscal_year_open", new=AsyncMock()), \
             patch("services.bank_parsers.get_journal", new=AsyncMock(return_value=journal)), \
             patch("services.bank_parsers.get_account", new=AsyncMock(return_value=account)):
            with self.assertRaises(HTTPException) as ctx:
                await import_statement(
                    db, fiscal_year_uuid=uuid4(), journal_uuid=journal.uuid, account_uuid=account.uuid,
                    file_content=b"x", filename="r.ofx", user_id=1,
                )
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_rejects_duplicate_content_hash(self):
        journal = _journal(type=3)
        account = _bank_account()
        existing = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=journal.uuid, account_uuid=account.uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=existing)

        with patch("services.bank_parsers.validate_fiscal_year_open", new=AsyncMock()), \
             patch("services.bank_parsers.get_journal", new=AsyncMock(return_value=journal)), \
             patch("services.bank_parsers.get_account", new=AsyncMock(return_value=account)):
            with self.assertRaises(HTTPException) as ctx:
                await import_statement(
                    db, fiscal_year_uuid=uuid4(), journal_uuid=journal.uuid, account_uuid=account.uuid,
                    file_content=_OFX_SAMPLE.encode(), filename="r.ofx", user_id=1,
                )
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_ofx_import_derives_opening_balance_instead_of_zeroing_it(self):
        journal = _journal(type=3)
        account = _bank_account()
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=None)  # no duplicate

        with patch("services.bank_parsers.validate_fiscal_year_open", new=AsyncMock()), \
             patch("services.bank_parsers.get_journal", new=AsyncMock(return_value=journal)), \
             patch("services.bank_parsers.get_account", new=AsyncMock(return_value=account)):
            statement = await import_statement(
                db, fiscal_year_uuid=uuid4(), journal_uuid=journal.uuid, account_uuid=account.uuid,
                file_content=_OFX_SAMPLE.encode(), filename="r.ofx", user_id=1,
            )

        # OFX only exposes closing_balance (4197.70); opening must be derived from it,
        # not forced to zero, or close_reconciliation's balance check would never pass.
        self.assertEqual(statement.closing_balance, Decimal("4197.70"))
        expected_opening = statement.closing_balance - statement.total_credits + statement.total_debits
        self.assertEqual(statement.opening_balance, expected_opening)
        self.assertNotEqual(statement.opening_balance, Decimal("0"))


class RunAutoMatchTests(IsolatedAsyncioTestCase):
    async def test_greedy_assignment_prefers_highest_score(self):
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="imported",
        )

        line_perfect = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0,
            line_date=date(2026, 6, 3), amount=Decimal("1000.00"), reference="REF1", match_status="unmatched",
        )
        line_no_match = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=1,
            line_date=date(2026, 6, 10), amount=Decimal("42.00"), match_status="unmatched",
        )

        entry_exact = _entry_with_bank_line(
            account_uuid, debit=Decimal("1000.00"), entry_date=date(2026, 6, 3), reference="REF1",
        )
        statement.lines = [line_perfect, line_no_match]

        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[entry_exact])):
            result = await run_auto_match(db, statement.uuid)

        self.assertEqual(result, {"auto_matched": 1, "flagged_review": 0, "unmatched": 1})
        self.assertEqual(line_perfect.match_status, "auto_matched")
        self.assertEqual(line_perfect.matched_entry_uuid, entry_exact.uuid)
        self.assertEqual(line_no_match.match_status, "unmatched")
        self.assertIsNone(line_no_match.matched_entry_uuid)
        self.assertEqual(statement.status, "matching")

    async def test_internal_transfer_capped_below_auto_accept(self):
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="imported",
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0,
            line_date=date(2026, 6, 3), amount=Decimal("500.00"), match_status="unmatched",
        )
        caisse = _bank_account(code="531", is_reconcilable=True)
        transfer_entry = _entry_with_bank_line(
            account_uuid, debit=Decimal("500.00"), entry_date=date(2026, 6, 3), other_account=caisse,
        )
        statement.lines = [line]

        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[transfer_entry])):
            result = await run_auto_match(db, statement.uuid)

        self.assertEqual(result, {"auto_matched": 0, "flagged_review": 1, "unmatched": 0})
        self.assertEqual(line.match_status, "discrepancy")
        self.assertEqual(line.match_confidence, Decimal("0.60"))

    async def test_include_drafts_flag_is_forwarded_to_eligible_entries_loader(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="imported",
        )
        statement.lines = []
        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[])) as mock_load:
            await run_auto_match(db, statement.uuid, include_drafts=True)

        mock_load.assert_awaited_once_with(db, statement, include_drafts=True)


class ManualMatchTests(IsolatedAsyncioTestCase):
    async def test_rejects_already_locked_line(self):
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=uuid4(), line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="auto_matched",
        )
        db = AsyncMock()
        db.get = AsyncMock(return_value=line)

        with self.assertRaises(HTTPException) as ctx:
            await manual_match(db, line.uuid, uuid4(), uuid4(), user_id=1)
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_rejects_entry_from_different_journal(self):
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        other_entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"))  # random journal_uuid != statement's

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        db.scalar = AsyncMock(return_value=other_entry)

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            with self.assertRaises(HTTPException) as ctx:
                await manual_match(db, line.uuid, other_entry.uuid, other_entry.fiscal_year_uuid, user_id=1)
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_successful_manual_match_sets_fields(self):
        account_uuid = uuid4()
        journal_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid, account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        entry.journal_uuid = journal_uuid
        entry.fiscal_year_uuid = fiscal_year_uuid
        entry.journal = _journal(uuid=journal_uuid, type=3)

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        # First db.scalar call resolves the entry; second checks for an existing match (none).
        db.scalar = AsyncMock(side_effect=[entry, None])

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            result = await manual_match(db, line.uuid, entry.uuid, fiscal_year_uuid, user_id=42)

        self.assertEqual(result.match_status, "manually_matched")
        self.assertEqual(result.matched_entry_uuid, entry.uuid)
        self.assertEqual(result.resolved_by, 42)

    async def test_rejects_draft_entry_by_default(self):
        account_uuid = uuid4()
        journal_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid, account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        draft_entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        draft_entry.journal_uuid = journal_uuid
        draft_entry.fiscal_year_uuid = fiscal_year_uuid
        draft_entry.journal = _journal(uuid=journal_uuid, type=3)
        draft_entry.state = 1

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        db.scalar = AsyncMock(return_value=draft_entry)

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            with self.assertRaises(HTTPException) as ctx:
                await manual_match(db, line.uuid, draft_entry.uuid, fiscal_year_uuid, user_id=1)
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_allows_draft_entry_when_include_drafts_true(self):
        account_uuid = uuid4()
        journal_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid, account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        draft_entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        draft_entry.journal_uuid = journal_uuid
        draft_entry.fiscal_year_uuid = fiscal_year_uuid
        draft_entry.journal = _journal(uuid=journal_uuid, type=3)
        draft_entry.state = 1

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        db.scalar = AsyncMock(side_effect=[draft_entry, None])

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            result = await manual_match(
                db, line.uuid, draft_entry.uuid, fiscal_year_uuid, user_id=1, include_drafts=True,
            )

        self.assertEqual(result.match_status, "manually_matched")
        self.assertEqual(result.matched_entry_uuid, draft_entry.uuid)

    async def test_rejects_cancelled_entry_even_with_include_drafts(self):
        account_uuid = uuid4()
        journal_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid, account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        cancelled_entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        cancelled_entry.journal_uuid = journal_uuid
        cancelled_entry.fiscal_year_uuid = fiscal_year_uuid
        cancelled_entry.journal = _journal(uuid=journal_uuid, type=3)
        cancelled_entry.state = 3

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        db.scalar = AsyncMock(return_value=cancelled_entry)

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            with self.assertRaises(HTTPException) as ctx:
                await manual_match(
                    db, line.uuid, cancelled_entry.uuid, fiscal_year_uuid, user_id=1, include_drafts=True,
                )
        self.assertEqual(ctx.exception.status_code, 400)


class UnmatchTests(IsolatedAsyncioTestCase):
    async def test_clears_match_fields(self):
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=uuid4(), line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="auto_matched", matched_entry_uuid=uuid4(),
            matched_fiscal_year_uuid=uuid4(), match_confidence=Decimal("0.95"),
        )
        db = AsyncMock()
        db.get = AsyncMock(return_value=line)

        result = await unmatch(db, line.uuid, "wrong suggestion")

        self.assertEqual(result.match_status, "unmatched")
        self.assertIsNone(result.matched_entry_uuid)
        self.assertIsNone(result.match_confidence)
        self.assertEqual(result.discrepancy_notes, "wrong suggestion")


class DetectDiscrepanciesTests(IsolatedAsyncioTestCase):
    async def test_unmatched_line_reported_as_missing_entry(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="matching",
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        statement.lines = [line]
        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            findings = await detect_discrepancies(db, statement.uuid)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["type"], "missing_entry")
        self.assertEqual(statement.status, "flagged")


class CloseReconciliationTests(IsolatedAsyncioTestCase):
    async def test_refuses_close_with_unresolved_lines(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
            opening_balance=Decimal("0"), closing_balance=Decimal("10"),
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="discrepancy",
        )
        statement.lines = [line]
        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            with self.assertRaises(HTTPException) as ctx:
                await close_reconciliation(db, statement.uuid, user_id=1)
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_refuses_close_on_balance_mismatch(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
            opening_balance=Decimal("0"), closing_balance=Decimal("999"),
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="auto_matched",
        )
        statement.lines = [line]
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_FakeExecuteResult([]))

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            with self.assertRaises(HTTPException) as ctx:
                await close_reconciliation(db, statement.uuid, user_id=1)
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_closes_when_balanced_and_resolved(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
            opening_balance=Decimal("0"), closing_balance=Decimal("10"), status="matching",
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="auto_matched",
        )
        statement.lines = [line]
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_FakeExecuteResult([]))

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            result = await close_reconciliation(db, statement.uuid, user_id=7)

        self.assertEqual(result.status, "reconciled")
        self.assertEqual(result.reconciled_by, 7)
        self.assertEqual(result.balance_difference, Decimal("0"))

    async def test_excluded_line_amount_counts_toward_balance(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
            opening_balance=Decimal("100"), closing_balance=Decimal("95"), status="matching",
        )
        matched_line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="auto_matched",
        )
        excluded_line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=1, line_date=date(2026, 6, 4),
            amount=Decimal("-15"), match_status="excluded",
        )
        statement.lines = [matched_line, excluded_line]
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_FakeExecuteResult([]))

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            result = await close_reconciliation(db, statement.uuid, user_id=7)

        # 100 opening + 10 (auto_matched) - 15 (excluded, still a real movement) = 95 == closing_balance
        self.assertEqual(result.status, "reconciled")
        self.assertEqual(result.balance_difference, Decimal("0"))

    async def test_refuses_close_with_unposted_correcting_entry(self):
        account_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
            opening_balance=Decimal("0"), closing_balance=Decimal("10"), status="matching",
        )
        draft_entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        draft_entry.fiscal_year_uuid = fiscal_year_uuid
        draft_entry.state = 1  # Draft — not yet posted
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="manually_matched",
            matched_entry_uuid=draft_entry.uuid, matched_fiscal_year_uuid=fiscal_year_uuid,
        )
        statement.lines = [line]
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_FakeExecuteResult([draft_entry]))

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            with self.assertRaises(HTTPException) as ctx:
                await close_reconciliation(db, statement.uuid, user_id=1)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("not posted", ctx.exception.detail)
