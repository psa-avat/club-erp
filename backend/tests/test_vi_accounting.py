"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi_accounting tests: realization/conversion revenue split (7067/7069)
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
from decimal import Decimal
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

from models import AccountingLine
from services.vi_accounting import create_vi_conversion_entry, create_vi_realization_entry


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def unique(self):
        return self

    def scalar_one_or_none(self):
        return self._row


class _FakeDb:
    def __init__(self, results):
        self._results = list(results)
        self.added: list = []

    async def execute(self, *_args, **_kwargs):
        return self._results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def commit(self):
        pass


def _account(**kwargs):
    return SimpleNamespace(uuid=uuid4(), **kwargs)


def _vi_type(*, insurance_amount, insurance_revenue_account=None, insurance_account=None):
    return SimpleNamespace(
        uuid=uuid4(),
        client_account=_account(),
        revenue_account=_account(),
        insurance_expense_account=_account(),
        insurance_revenue_account=insurance_revenue_account,
        insurance_account=insurance_account,
        insurance_tiers_uuid=uuid4() if insurance_account else None,
        insurance_amount=insurance_amount,
    )


def _entitlement(*, vi_type, amount_ttc, insurance_amount_override=None, realization_entry_uuid=None):
    return SimpleNamespace(
        uuid=uuid4(),
        code="VI2026-0099",
        vi_type=vi_type,
        amount_ttc=amount_ttc,
        insurance_amount_override=insurance_amount_override,
        buyer_member_uuid=uuid4(),
        realisation_date=None,
        realization_entry_uuid=realization_entry_uuid,
        conversion_entry_uuid=None,
        registered_member_uuid=None,
        flight_links=[],
    )


def _lines_by_account(db, account_obj):
    return [ln for ln in db.added if isinstance(ln, AccountingLine) and ln.account_uuid == account_obj.uuid]


class VIRealizationRevenueSplitTests(IsolatedAsyncioTestCase):
    async def test_splits_7067_and_7069_when_insurance_revenue_account_configured(self):
        insurance_account = _account()
        insurance_revenue_account = _account()
        vi_type = _vi_type(
            insurance_amount=Decimal("15"),
            insurance_revenue_account=insurance_revenue_account,
            insurance_account=insurance_account,
        )
        entitlement = _entitlement(vi_type=vi_type, amount_ttc=Decimal("140"))
        journal = SimpleNamespace(uuid=uuid4())
        db = _FakeDb([_FakeResult(entitlement), _FakeResult(journal)])

        await create_vi_realization_entry(
            db=db, entitlement_uuid=entitlement.uuid, fiscal_year_uuid=uuid4(), user_id=1,
        )

        revenue_lines = _lines_by_account(db, vi_type.revenue_account)
        self.assertEqual(len(revenue_lines), 1)
        self.assertEqual(revenue_lines[0].credit, Decimal("125"))

        ins_rev_lines = _lines_by_account(db, insurance_revenue_account)
        self.assertEqual(len(ins_rev_lines), 1)
        self.assertEqual(ins_rev_lines[0].credit, Decimal("15"))

        total_debit = sum(ln.debit for ln in db.added if isinstance(ln, AccountingLine))
        total_credit = sum(ln.credit for ln in db.added if isinstance(ln, AccountingLine))
        self.assertEqual(total_debit, total_credit)
        self.assertEqual(total_debit, Decimal("155"))

    async def test_falls_back_to_full_amount_when_insurance_revenue_account_not_configured(self):
        insurance_account = _account()
        vi_type = _vi_type(insurance_amount=Decimal("15"), insurance_account=insurance_account)
        entitlement = _entitlement(vi_type=vi_type, amount_ttc=Decimal("140"))
        journal = SimpleNamespace(uuid=uuid4())
        db = _FakeDb([_FakeResult(entitlement), _FakeResult(journal)])

        await create_vi_realization_entry(
            db=db, entitlement_uuid=entitlement.uuid, fiscal_year_uuid=uuid4(), user_id=1,
        )

        revenue_lines = _lines_by_account(db, vi_type.revenue_account)
        self.assertEqual(len(revenue_lines), 1)
        self.assertEqual(revenue_lines[0].credit, Decimal("140"))

        total_debit = sum(ln.debit for ln in db.added if isinstance(ln, AccountingLine))
        total_credit = sum(ln.credit for ln in db.added if isinstance(ln, AccountingLine))
        self.assertEqual(total_debit, total_credit)


class VIConversionRevenueSplitTests(IsolatedAsyncioTestCase):
    async def test_reverses_7067_and_7069_when_insurance_revenue_account_configured(self):
        insurance_account = _account()
        insurance_revenue_account = _account()
        vi_type = _vi_type(
            insurance_amount=Decimal("15"),
            insurance_revenue_account=insurance_revenue_account,
            insurance_account=insurance_account,
        )
        entitlement = _entitlement(
            vi_type=vi_type, amount_ttc=Decimal("140"), realization_entry_uuid=uuid4(),
        )
        member = SimpleNamespace(uuid=uuid4(), account_id="ME2026-0001")
        receivable_account = _account(code="411")
        journal = SimpleNamespace(uuid=uuid4())
        db = _FakeDb([
            _FakeResult(entitlement),
            _FakeResult(member),
            _FakeResult(receivable_account),
            _FakeResult(journal),
        ])

        await create_vi_conversion_entry(
            db=db,
            entitlement_uuid=entitlement.uuid,
            registered_member_uuid=member.uuid,
            fiscal_year_uuid=uuid4(),
            user_id=1,
        )

        revenue_lines = _lines_by_account(db, vi_type.revenue_account)
        self.assertEqual(len(revenue_lines), 1)
        self.assertEqual(revenue_lines[0].debit, Decimal("125"))

        ins_rev_lines = _lines_by_account(db, insurance_revenue_account)
        self.assertEqual(len(ins_rev_lines), 1)
        self.assertEqual(ins_rev_lines[0].debit, Decimal("15"))

        total_debit = sum(ln.debit for ln in db.added if isinstance(ln, AccountingLine))
        total_credit = sum(ln.credit for ln in db.added if isinstance(ln, AccountingLine))
        self.assertEqual(total_debit, total_credit)
