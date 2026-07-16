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
    _DEFAULT_MATCHING_SETTINGS,
    _entry_bank_line,
    _is_internal_transfer_candidate,
    _score_candidate,
    close_reconciliation,
    detect_discrepancies,
    get_match_candidates,
    get_reconciliation_report,
    list_statement_lines,
    list_statement_summaries,
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


class _FakeRowsResult:
    """Mimics a raw (non-ORM) SQLAlchemy execute() result: a sequence of row tuples,
    iterable directly and via .all() (used by the GROUP BY aggregate queries)."""

    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)

    def all(self):
        return self._rows


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

    def test_decodes_utf8_body_mislabeled_as_usascii_1252(self):
        # Common real-world bank export bug: header declares ENCODING:USASCII /
        # CHARSET:1252 but the body bytes are actually UTF-8. Without correction,
        # ofxparse decodes "émis" (0xC3 0xA9) as cp1252, producing "Ã©mis".
        sample = _OFX_SAMPLE.replace("Cotisation", "Virement émis").encode("utf-8")

        parsed = OfxParser.parse(sample)

        self.assertEqual(parsed.lines[0].description, "Virement émis")

    def test_decodes_genuinely_cp1252_body_correctly(self):
        # A file whose header accurately declares CHARSET:1252 and whose body really
        # is cp1252-encoded should still decode correctly after normalization.
        sample = _OFX_SAMPLE.replace("Cotisation", "Virement émis").encode("cp1252")

        parsed = OfxParser.parse(sample)

        self.assertEqual(parsed.lines[0].description, "Virement émis")


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
    def _settings(self, **overrides):
        settings = dict(_DEFAULT_MATCHING_SETTINGS)
        settings.update(overrides)
        return settings

    def test_exact_amount_and_date_with_perfect_description_scores_top(self):
        score = _score_candidate(
            amount_diff=Decimal("0"), date_diff=0, description_score=1.0, settings=self._settings(),
        )
        self.assertEqual(score, Decimal("1.000"))

    def test_amount_beyond_tolerance_scores_zero_on_amount_component(self):
        # amount_component floors at 0 beyond the tolerance; date+description still contribute.
        score = _score_candidate(
            amount_diff=Decimal("10"), date_diff=0, description_score=1.0,
            settings=self._settings(amount_tolerance="0.05"),
        )
        # weight_date(0.3) + weight_description(0.2) fully credited, amount(0.5) is zero:
        # (0*0.5 + 1*0.3 + 1*0.2) / 1.0 = 0.5
        self.assertEqual(score, Decimal("0.500"))

    def test_date_beyond_tolerance_decays_to_zero_component(self):
        score_at_tolerance = _score_candidate(
            amount_diff=Decimal("0"), date_diff=7, description_score=0.0, settings=self._settings(),
        )
        score_beyond = _score_candidate(
            amount_diff=Decimal("0"), date_diff=30, description_score=0.0, settings=self._settings(),
        )
        # Both should score the amount component only (0.5 weight) since date/description are 0.
        self.assertEqual(score_at_tolerance, Decimal("0.500"))
        self.assertEqual(score_beyond, Decimal("0.500"))

    def test_description_similarity_contributes_partial_credit(self):
        score = _score_candidate(
            amount_diff=Decimal("0"), date_diff=7, description_score=0.5, settings=self._settings(),
        )
        # amount=1*0.5 + date=0*0.3 + description=0.5*0.2 = 0.6
        self.assertEqual(score, Decimal("0.600"))

    def test_entry_bank_line_finds_matching_account(self):
        account_uuid = uuid4()
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("100"))
        line = _entry_bank_line(entry, account_uuid)
        self.assertIsNotNone(line)
        self.assertEqual(line.account_uuid, account_uuid)

    def test_internal_transfer_detected_via_other_treasury_account(self):
        account_uuid = uuid4()
        caisse = _bank_account(code="531", type=1, is_reconcilable=True)
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("100"), other_account=caisse)
        bank_line = _entry_bank_line(entry, account_uuid)
        self.assertTrue(_is_internal_transfer_candidate(entry, bank_line))

    def test_not_internal_transfer_when_other_side_is_not_treasury(self):
        account_uuid = uuid4()
        member_account = _bank_account(code="411", type=1, is_reconcilable=False)
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("100"), other_account=member_account)
        bank_line = _entry_bank_line(entry, account_uuid)
        self.assertFalse(_is_internal_transfer_candidate(entry, bank_line))

    def test_not_internal_transfer_for_reconcilable_third_party_account(self):
        # Regression: 411 "Membres - Créances" is_reconcilable=True (for lettrage of
        # invoices vs payments) must NOT be mistaken for a treasury/bank-cash account —
        # a routine member payment (Banque <-> 411) is not an inter-account transfer.
        account_uuid = uuid4()
        member_account = _bank_account(code="411", type=1, is_reconcilable=True)
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
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[entry_exact])), \
             patch("services.bank_reconciliation._load_matched_line_uuids", new=AsyncMock(return_value=set())), \
             patch("services.bank_reconciliation.get_matching_settings", new=AsyncMock(return_value=dict(_DEFAULT_MATCHING_SETTINGS))):
            result = await run_auto_match(db, statement.uuid)

        self.assertEqual(result, {"auto_matched": 1, "flagged_review": 0, "unmatched": 1})
        self.assertEqual(line_perfect.match_status, "auto_matched")
        self.assertEqual(line_perfect.matched_entry_uuid, entry_exact.uuid)
        self.assertEqual(line_no_match.match_status, "unmatched")
        self.assertIsNone(line_no_match.matched_entry_uuid)
        self.assertEqual(statement.status, "matching")

    async def test_multi_line_entry_matches_each_line_to_a_different_statement_line(self):
        # Regression for the bug this migration fixes: a single journal entry with
        # several distinct lines on account 512 (e.g. a payroll entry posting multiple
        # acomptes) must be able to satisfy multiple statement lines, one per 512 line —
        # not just the first one found.
        account_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        entry_uuid = uuid4()
        entry = AccountingEntry(
            uuid=entry_uuid, fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(),
            entry_date=date(2026, 1, 5), description="Salaire Brut PS Janvier", state=2,
        )
        bank_line_1 = AccountingLine(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
            account_uuid=account_uuid, debit=Decimal("0"), credit=Decimal("360.00"),
        )
        bank_line_1.account = _bank_account(uuid=account_uuid)
        bank_line_2 = AccountingLine(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
            account_uuid=account_uuid, debit=Decimal("0"), credit=Decimal("500.00"),
        )
        bank_line_2.account = _bank_account(uuid=account_uuid)
        entry.lines = [bank_line_1, bank_line_2]

        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 1, 31), source_format="ofx", created_by=1, status="imported",
        )
        stmt_line_1 = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0,
            line_date=date(2026, 1, 5), amount=Decimal("-360.00"), match_status="unmatched",
            description="Salaire Brut PS Janvier",
        )
        stmt_line_2 = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=1,
            line_date=date(2026, 1, 5), amount=Decimal("-500.00"), match_status="unmatched",
            description="Salaire Brut PS Janvier",
        )
        statement.lines = [stmt_line_1, stmt_line_2]

        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[entry])), \
             patch("services.bank_reconciliation._load_matched_line_uuids", new=AsyncMock(return_value=set())), \
             patch("services.bank_reconciliation.get_matching_settings", new=AsyncMock(return_value=dict(_DEFAULT_MATCHING_SETTINGS))):
            result = await run_auto_match(db, statement.uuid)

        self.assertEqual(result, {"auto_matched": 2, "flagged_review": 0, "unmatched": 0})
        self.assertEqual(stmt_line_1.match_status, "auto_matched")
        self.assertEqual(stmt_line_1.matched_entry_uuid, entry.uuid)
        self.assertEqual(stmt_line_1.matched_line_uuid, bank_line_1.uuid)
        self.assertEqual(stmt_line_2.match_status, "auto_matched")
        self.assertEqual(stmt_line_2.matched_entry_uuid, entry.uuid)
        self.assertEqual(stmt_line_2.matched_line_uuid, bank_line_2.uuid)

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
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[transfer_entry])), \
             patch("services.bank_reconciliation._load_matched_line_uuids", new=AsyncMock(return_value=set())), \
             patch("services.bank_reconciliation.get_matching_settings", new=AsyncMock(return_value=dict(_DEFAULT_MATCHING_SETTINGS))):
            result = await run_auto_match(db, statement.uuid)

        self.assertEqual(result, {"auto_matched": 0, "flagged_review": 1, "unmatched": 0})
        self.assertEqual(line.match_status, "discrepancy")
        self.assertEqual(line.match_confidence, Decimal("0.60"))

    async def test_near_amount_high_score_is_never_auto_matched(self):
        # A candidate whose amount is within tolerance (not exact) but whose date and
        # description are both perfect can still reach a weighted score >= the
        # auto_accept_threshold — that must NEVER become 'auto_matched' on its own.
        # A fully automatic match requires an exact amount; anything short of exact is
        # always left as 'discrepancy' for a human to confirm, however high the score.
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="imported",
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0,
            line_date=date(2026, 6, 3), amount=Decimal("1000.00"), match_status="unmatched",
            description="Cotisation Dupont",
        )
        entry = _entry_with_bank_line(
            account_uuid, debit=Decimal("1000.01"), entry_date=date(2026, 6, 3), description="Cotisation Dupont",
        )
        statement.lines = [line]

        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[entry])), \
             patch("services.bank_reconciliation._load_matched_line_uuids", new=AsyncMock(return_value=set())), \
             patch("services.bank_reconciliation.get_matching_settings", new=AsyncMock(return_value=dict(_DEFAULT_MATCHING_SETTINGS))):
            result = await run_auto_match(db, statement.uuid)

        # Score reaches exactly the 0.90 auto_accept_threshold (0.8 amount + 1.0 date +
        # 1.0 description, weighted 0.5/0.3/0.2) — high enough for the old score-only
        # rule, but the 0.01 amount gap must still block auto-acceptance.
        self.assertEqual(result, {"auto_matched": 0, "flagged_review": 1, "unmatched": 0})
        self.assertEqual(line.match_status, "discrepancy")
        self.assertEqual(line.match_confidence, Decimal("0.900"))
        self.assertEqual(line.discrepancy_type, "amount_variance")
        self.assertEqual(line.matched_entry_uuid, entry.uuid)

    async def test_include_drafts_flag_is_forwarded_to_eligible_entries_loader(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="imported",
        )
        statement.lines = []
        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[])) as mock_load, \
             patch("services.bank_reconciliation._load_matched_line_uuids", new=AsyncMock(return_value=set())), \
             patch("services.bank_reconciliation.get_matching_settings", new=AsyncMock(return_value=dict(_DEFAULT_MATCHING_SETTINGS))):
            await run_auto_match(db, statement.uuid, include_drafts=True)

        mock_load.assert_awaited_once_with(db, statement, include_drafts=True)

    async def test_defaults_to_including_drafts(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="imported",
        )
        statement.lines = []
        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[])) as mock_load, \
             patch("services.bank_reconciliation._load_matched_line_uuids", new=AsyncMock(return_value=set())), \
             patch("services.bank_reconciliation.get_matching_settings", new=AsyncMock(return_value=dict(_DEFAULT_MATCHING_SETTINGS))):
            await run_auto_match(db, statement.uuid)

        mock_load.assert_awaited_once_with(db, statement, include_drafts=True)


class GetMatchCandidatesTests(IsolatedAsyncioTestCase):
    async def test_ranks_candidates_by_score_and_excludes_out_of_tolerance_amounts(self):
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="matching",
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0,
            line_date=date(2026, 6, 3), amount=Decimal("1000.00"), match_status="unmatched",
        )
        entry_exact = _entry_with_bank_line(
            account_uuid, debit=Decimal("1000.00"), entry_date=date(2026, 6, 3), description="Perfect match",
        )
        entry_close = _entry_with_bank_line(
            account_uuid, debit=Decimal("999.99"), entry_date=date(2026, 6, 5), description="Close match",
        )
        entry_out_of_tolerance = _entry_with_bank_line(
            account_uuid, debit=Decimal("500.00"), entry_date=date(2026, 6, 3), description="Wrong amount",
        )
        db = AsyncMock()
        db.get = AsyncMock(return_value=line)

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch(
                 "services.bank_reconciliation._load_eligible_entries",
                 new=AsyncMock(return_value=[entry_close, entry_exact, entry_out_of_tolerance]),
             ), \
             patch("services.bank_reconciliation._load_matched_line_uuids", new=AsyncMock(return_value=set())), \
             patch("services.bank_reconciliation.get_matching_settings", new=AsyncMock(return_value=dict(_DEFAULT_MATCHING_SETTINGS))):
            candidates = await get_match_candidates(db, line.uuid)

        self.assertEqual(len(candidates), 2)
        self.assertEqual(candidates[0]["entry_uuid"], entry_exact.uuid)
        self.assertEqual(candidates[0]["amount_diff"], Decimal("0"))
        self.assertEqual(candidates[1]["entry_uuid"], entry_close.uuid)
        self.assertGreater(candidates[0]["score"], candidates[1]["score"])

    async def test_already_matched_entries_never_appear_since_loader_excludes_them(self):
        # get_match_candidates relies on _load_eligible_entries, whose real SQL query
        # excludes entries already reconciled to another line (an entry can only be
        # matched once). Simulating that exclusion here by simply not returning the
        # already-matched entry from the (mocked) loader.
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="matching",
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0,
            line_date=date(2026, 6, 3), amount=Decimal("60.00"), match_status="unmatched",
        )
        db = AsyncMock()
        db.get = AsyncMock(return_value=line)

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[])) as mock_load, \
             patch("services.bank_reconciliation._load_matched_line_uuids", new=AsyncMock(return_value=set())), \
             patch("services.bank_reconciliation.get_matching_settings", new=AsyncMock(return_value=dict(_DEFAULT_MATCHING_SETTINGS))):
            candidates = await get_match_candidates(db, line.uuid)

        self.assertEqual(candidates, [])
        mock_load.assert_awaited_once()

    async def test_internal_transfer_score_capped_in_candidates(self):
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="matching",
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0,
            line_date=date(2026, 6, 3), amount=Decimal("500.00"), match_status="unmatched",
        )
        caisse = _bank_account(code="531", is_reconcilable=True)
        transfer_entry = _entry_with_bank_line(
            account_uuid, debit=Decimal("500.00"), entry_date=date(2026, 6, 3), other_account=caisse,
        )
        db = AsyncMock()
        db.get = AsyncMock(return_value=line)

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_eligible_entries", new=AsyncMock(return_value=[transfer_entry])), \
             patch("services.bank_reconciliation._load_matched_line_uuids", new=AsyncMock(return_value=set())), \
             patch("services.bank_reconciliation.get_matching_settings", new=AsyncMock(return_value=dict(_DEFAULT_MATCHING_SETTINGS))):
            candidates = await get_match_candidates(db, line.uuid)

        self.assertEqual(len(candidates), 1)
        self.assertTrue(candidates[0]["is_internal_transfer"])
        self.assertEqual(candidates[0]["score"], Decimal(str(_DEFAULT_MATCHING_SETTINGS["internal_transfer_cap"])))

    async def test_raises_404_when_line_not_found(self):
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)

        with self.assertRaises(HTTPException) as ctx:
            await get_match_candidates(db, uuid4())
        self.assertEqual(ctx.exception.status_code, 404)


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

    async def test_rejects_entry_from_different_fiscal_year(self):
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        other_entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"))  # random fiscal_year_uuid != statement's

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        db.scalar = AsyncMock(return_value=other_entry)

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            with self.assertRaises(HTTPException) as ctx:
                await manual_match(db, line.uuid, other_entry.uuid, other_entry.fiscal_year_uuid, user_id=1)
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_accepts_entry_from_a_different_journal_when_account_and_fiscal_year_match(self):
        # Matching is scoped by account, not journal: an entry recorded in another
        # journal (e.g. a correcting OD entry) can still have a line on the bank
        # account and legitimately reconcile against this statement.
        account_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        other_entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        other_entry.fiscal_year_uuid = fiscal_year_uuid  # same fiscal year, unrelated (random) journal_uuid

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        db.scalar = AsyncMock(side_effect=[other_entry, None])

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            result = await manual_match(db, line.uuid, other_entry.uuid, fiscal_year_uuid, user_id=1)

        self.assertEqual(result.match_status, "manually_matched")
        self.assertEqual(result.matched_entry_uuid, other_entry.uuid)

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

    async def test_rejects_draft_entry_when_include_drafts_explicitly_disabled(self):
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
                await manual_match(db, line.uuid, draft_entry.uuid, fiscal_year_uuid, user_id=1, include_drafts=False)
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

    async def test_multi_line_entry_picks_specific_line_via_entry_line_uuid(self):
        # Regression: matching must operate per accounting line, not per whole entry, so
        # a second statement line can be matched to a different 512 line of an entry
        # that's already partially matched.
        account_uuid = uuid4()
        journal_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        entry_uuid = uuid4()
        entry = AccountingEntry(
            uuid=entry_uuid, fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid,
            entry_date=date(2026, 1, 20), description="Salaire Brut PS Janvier", state=2,
        )
        bank_line_1 = AccountingLine(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
            account_uuid=account_uuid, debit=Decimal("0"), credit=Decimal("360.00"),
        )
        bank_line_2 = AccountingLine(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
            account_uuid=account_uuid, debit=Decimal("0"), credit=Decimal("500.00"),
        )
        entry.lines = [bank_line_1, bank_line_2]

        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=journal_uuid, account_uuid=account_uuid,
            statement_date=date(2026, 1, 31), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=1, line_date=date(2026, 1, 12),
            amount=Decimal("-500.00"), match_status="unmatched",
        )

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        # First db.scalar call resolves the entry; second checks the specific line isn't
        # already claimed (bank_line_1 was already matched to another statement line).
        db.scalar = AsyncMock(side_effect=[entry, None])

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            result = await manual_match(
                db, line.uuid, entry.uuid, fiscal_year_uuid, user_id=1, entry_line_uuid=bank_line_2.uuid,
            )

        self.assertEqual(result.match_status, "manually_matched")
        self.assertEqual(result.matched_entry_uuid, entry.uuid)
        self.assertEqual(result.matched_line_uuid, bank_line_2.uuid)

    async def test_rejects_entry_line_uuid_not_belonging_to_entry(self):
        account_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        entry.fiscal_year_uuid = fiscal_year_uuid

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        db.scalar = AsyncMock(return_value=entry)

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            with self.assertRaises(HTTPException) as ctx:
                await manual_match(
                    db, line.uuid, entry.uuid, fiscal_year_uuid, user_id=1, entry_line_uuid=uuid4(),
                )
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_rejects_already_claimed_specific_line(self):
        account_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        entry.fiscal_year_uuid = fiscal_year_uuid
        bank_line = entry.lines[0]

        db = AsyncMock()
        db.get = AsyncMock(return_value=line)
        # First db.scalar resolves the entry; second (already_matched check) reports the
        # line is already claimed by another statement line.
        db.scalar = AsyncMock(side_effect=[entry, uuid4()])

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            with self.assertRaises(HTTPException) as ctx:
                await manual_match(
                    db, line.uuid, entry.uuid, fiscal_year_uuid, user_id=1, entry_line_uuid=bank_line.uuid,
                )
        self.assertEqual(ctx.exception.status_code, 409)


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

    async def test_two_lines_matched_to_different_lines_of_same_entry_is_not_a_duplicate(self):
        # Regression: two statement lines legitimately matched to two distinct 512 lines
        # of the same multi-line entry must not be flagged as a duplicate match.
        account_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        entry_uuid = uuid4()
        entry = AccountingEntry(
            uuid=entry_uuid, fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(),
            entry_date=date(2026, 1, 5), description="Salaire Brut PS Janvier", state=2,
        )
        bank_line_1 = AccountingLine(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
            account_uuid=account_uuid, debit=Decimal("0"), credit=Decimal("360.00"),
        )
        bank_line_2 = AccountingLine(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, entry_uuid=entry_uuid,
            account_uuid=account_uuid, debit=Decimal("0"), credit=Decimal("500.00"),
        )
        entry.lines = [bank_line_1, bank_line_2]

        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 1, 31), source_format="ofx", created_by=1, status="matching",
        )
        stmt_line_1 = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 1, 5),
            amount=Decimal("-360.00"), match_status="auto_matched",
            matched_entry_uuid=entry.uuid, matched_fiscal_year_uuid=fiscal_year_uuid, matched_line_uuid=bank_line_1.uuid,
        )
        stmt_line_2 = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=1, line_date=date(2026, 1, 12),
            amount=Decimal("-500.00"), match_status="auto_matched",
            matched_entry_uuid=entry.uuid, matched_fiscal_year_uuid=fiscal_year_uuid, matched_line_uuid=bank_line_2.uuid,
        )
        statement.lines = [stmt_line_1, stmt_line_2]
        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch(
                 "services.bank_reconciliation._load_matched_entries",
                 new=AsyncMock(return_value={(entry.uuid, fiscal_year_uuid): entry}),
             ):
            findings = await detect_discrepancies(db, statement.uuid)

        self.assertEqual(findings, [])
        self.assertEqual(stmt_line_1.match_status, "auto_matched")
        self.assertEqual(stmt_line_2.match_status, "auto_matched")

    async def test_manually_matched_line_with_timing_finding_is_not_downgraded(self):
        # A manual match is an explicit human confirmation — running matching (which
        # triggers detect_discrepancies right after) must not silently flip it back to
        # 'discrepancy' just because, say, the entry date is a bit far from the line date.
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="matching",
        )
        entry = _entry_with_bank_line(
            account_uuid, debit=Decimal("10"), entry_date=date(2026, 5, 1),  # far from line_date -> timing finding
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="manually_matched",
            matched_entry_uuid=entry.uuid, matched_fiscal_year_uuid=entry.fiscal_year_uuid,
        )
        statement.lines = [line]
        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_matched_entries", new=AsyncMock(return_value={(entry.uuid, entry.fiscal_year_uuid): entry})):
            findings = await detect_discrepancies(db, statement.uuid)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["type"], "timing")
        # The finding is reported, but the line itself stays exactly as manually confirmed:
        self.assertEqual(line.match_status, "manually_matched")
        self.assertIsNone(line.discrepancy_type)

    async def test_auto_matched_line_with_timing_finding_is_downgraded_to_discrepancy(self):
        # Contrast case: an auto_matched line was never human-reviewed, so it's still
        # fair game for detect_discrepancies to flag it for manual review.
        account_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="matching",
        )
        entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 5, 1))
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="auto_matched",
            matched_entry_uuid=entry.uuid, matched_fiscal_year_uuid=entry.fiscal_year_uuid,
        )
        statement.lines = [line]
        db = AsyncMock()

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation._load_matched_entries", new=AsyncMock(return_value={(entry.uuid, entry.fiscal_year_uuid): entry})):
            findings = await detect_discrepancies(db, statement.uuid)

        self.assertEqual(len(findings), 1)
        self.assertEqual(line.match_status, "discrepancy")
        self.assertEqual(line.discrepancy_type, "timing")


class GetReconciliationReportTests(IsolatedAsyncioTestCase):
    async def test_live_balance_difference_computed_for_open_statement(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="matching",
            opening_balance=Decimal("100.00"), closing_balance=Decimal("160.00"),
        )
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("50.00"), match_status="auto_matched",
        )
        statement.lines = [line]
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_FakeExecuteResult([]))

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            report = await get_reconciliation_report(db, statement.uuid)

        # expected_closing = opening(100) + reconciled(50) = 150; closing=160 -> diff=10
        self.assertEqual(report["live_balance_difference"], Decimal("10.00"))

    async def test_live_balance_difference_uses_stored_value_when_reconciled(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="reconciled",
            opening_balance=Decimal("100.00"), closing_balance=Decimal("160.00"),
            balance_difference=Decimal("0.00"),
        )
        statement.lines = []
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_FakeExecuteResult([]))

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)):
            report = await get_reconciliation_report(db, statement.uuid)

        self.assertEqual(report["live_balance_difference"], Decimal("0.00"))


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

    async def test_posts_draft_matched_entries_before_closing(self):
        account_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
            opening_balance=Decimal("0"), closing_balance=Decimal("10"), status="matching",
        )
        draft_entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        draft_entry.fiscal_year_uuid = fiscal_year_uuid
        draft_entry.state = 1  # Draft — reconciling is what confirms and posts it
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="manually_matched",
            matched_entry_uuid=draft_entry.uuid, matched_fiscal_year_uuid=fiscal_year_uuid,
        )
        statement.lines = [line]
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_FakeExecuteResult([draft_entry]))

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch(
                 "services.bank_reconciliation.post_accounting_entries_batch",
                 new=AsyncMock(return_value=[draft_entry]),
             ) as mock_post:
            result = await close_reconciliation(db, statement.uuid, user_id=1)

        mock_post.assert_awaited_once_with(db, fiscal_year_uuid, [draft_entry.uuid])
        self.assertEqual(result.status, "reconciled")

    async def test_skips_posting_when_no_draft_matched_entries(self):
        account_uuid = uuid4()
        fiscal_year_uuid = uuid4()
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=fiscal_year_uuid, journal_uuid=uuid4(), account_uuid=account_uuid,
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1,
            opening_balance=Decimal("0"), closing_balance=Decimal("10"), status="matching",
        )
        posted_entry = _entry_with_bank_line(account_uuid, debit=Decimal("10"), entry_date=date(2026, 6, 3))
        posted_entry.fiscal_year_uuid = fiscal_year_uuid
        posted_entry.state = 2  # Already posted
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement.uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="auto_matched",
            matched_entry_uuid=posted_entry.uuid, matched_fiscal_year_uuid=fiscal_year_uuid,
        )
        statement.lines = [line]
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_FakeExecuteResult([posted_entry]))

        with patch("services.bank_reconciliation.get_statement", new=AsyncMock(return_value=statement)), \
             patch("services.bank_reconciliation.post_accounting_entries_batch", new=AsyncMock()) as mock_post:
            result = await close_reconciliation(db, statement.uuid, user_id=1)

        mock_post.assert_not_called()
        self.assertEqual(result.status, "reconciled")


class ListStatementLinesTests(IsolatedAsyncioTestCase):
    async def test_returns_items_and_total_from_paginated_query(self):
        statement_uuid = uuid4()
        line = BankStatementLine(
            uuid=uuid4(), statement_uuid=statement_uuid, line_index=0, line_date=date(2026, 6, 3),
            amount=Decimal("10"), match_status="unmatched",
        )
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=137)
        db.execute = AsyncMock(return_value=_FakeExecuteResult([line]))

        items, total = await list_statement_lines(db, statement_uuid, limit=50, offset=0)

        self.assertEqual(items, [line])
        self.assertEqual(total, 137)

    async def test_defaults_total_to_zero_when_count_is_none(self):
        statement_uuid = uuid4()
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=None)
        db.execute = AsyncMock(return_value=_FakeExecuteResult([]))

        items, total = await list_statement_lines(db, statement_uuid)

        self.assertEqual(items, [])
        self.assertEqual(total, 0)

    async def test_comma_separated_match_status_filters_on_multiple_statuses(self):
        # The default "unresolved" queue sends match_status="unmatched,discrepancy"
        # as a single query param rather than requiring a separate list param.
        statement_uuid = uuid4()
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=2)
        db.execute = AsyncMock(return_value=_FakeExecuteResult([]))

        await list_statement_lines(db, statement_uuid, match_status="unmatched,discrepancy")

        where_clause = str(db.execute.call_args[0][0])
        self.assertIn("match_status IN", where_clause)


class ListStatementSummariesTests(IsolatedAsyncioTestCase):
    async def test_computes_counts_and_live_balance_difference_for_open_statement(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="matching",
            opening_balance=Decimal("100.00"), closing_balance=Decimal("160.00"),
        )
        db = AsyncMock()
        db.execute = AsyncMock(
            side_effect=[
                _FakeRowsResult(
                    [
                        (statement.uuid, "auto_matched", 3),
                        (statement.uuid, "unmatched", 2),
                        (statement.uuid, "discrepancy", 1),
                    ]
                ),
                _FakeRowsResult([(statement.uuid, Decimal("50.00"))]),
            ]
        )

        with patch("services.bank_reconciliation.list_statements", new=AsyncMock(return_value=[statement])):
            summaries = await list_statement_summaries(db)

        self.assertEqual(len(summaries), 1)
        summary = summaries[0]
        self.assertEqual(summary["status_counts"], {"auto_matched": 3, "unmatched": 2, "discrepancy": 1})
        self.assertEqual(summary["unresolved_count"], 3)
        # expected_closing = opening(100) + reconciled_sum(50) = 150; statement closing = 160 -> diff = 10
        self.assertEqual(summary["live_balance_difference"], Decimal("10.00"))

    async def test_reconciled_statement_uses_stored_balance_difference_not_live_computation(self):
        statement = BankStatement(
            uuid=uuid4(), fiscal_year_uuid=uuid4(), journal_uuid=uuid4(), account_uuid=uuid4(),
            statement_date=date(2026, 6, 30), source_format="ofx", created_by=1, status="reconciled",
            opening_balance=Decimal("100.00"), closing_balance=Decimal("160.00"),
            balance_difference=Decimal("0.00"),
        )
        db = AsyncMock()
        db.execute = AsyncMock(
            side_effect=[
                _FakeRowsResult([(statement.uuid, "auto_matched", 5)]),
                _FakeRowsResult([(statement.uuid, Decimal("60.00"))]),
            ]
        )

        with patch("services.bank_reconciliation.list_statements", new=AsyncMock(return_value=[statement])):
            summaries = await list_statement_summaries(db)

        self.assertEqual(summaries[0]["live_balance_difference"], Decimal("0.00"))
        self.assertEqual(summaries[0]["unresolved_count"], 0)

    async def test_returns_empty_list_without_querying_aggregates_when_no_statements(self):
        db = AsyncMock()
        with patch("services.bank_reconciliation.list_statements", new=AsyncMock(return_value=[])):
            summaries = await list_statement_summaries(db)

        self.assertEqual(summaries, [])
        db.execute.assert_not_called()
