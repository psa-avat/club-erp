"""
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - assets tests: parent/child hierarchy validation, GL account resolution, is_priced/is_bookable
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
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

from fastapi import HTTPException

from schemas.assets import AssetCreateRequest, AssetFamilyCreateRequest
from services.assets import (
    _assert_asset_gl_accounts_exist,
    _assert_family_gl_accounts_exist,
    _serialize_asset,
    _validate_parent_asset_uuid,
    list_child_assets,
)


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _FakeDb:
    def __init__(self, execute_results=None):
        self.execute_results = list(execute_results or [])

    async def execute(self, *_args, **_kwargs):
        if not self.execute_results:
            return _FakeResult([])
        return self.execute_results.pop(0)


def _fake_account(code):
    return SimpleNamespace(code=code) if code else None


def _fake_family(
    *,
    acquisition_account_uuid=None,
    depreciation_account_uuid=None,
    charge_account_uuid=None,
    revenue_account_uuid=None,
):
    return SimpleNamespace(
        uuid=uuid4(),
        code="AIRCRAFT",
        name="Aircrafts",
        pricing_strategy=1,
        is_active=True,
        is_priced=True,
        pricing_versions=[],
        acquisition_account_uuid=acquisition_account_uuid,
        acquisition_account_code="21821" if acquisition_account_uuid else None,
        acquisition_account=_fake_account("21821" if acquisition_account_uuid else None),
        depreciation_account_uuid=depreciation_account_uuid,
        depreciation_account_code="281821" if depreciation_account_uuid else None,
        depreciation_account=_fake_account("281821" if depreciation_account_uuid else None),
        charge_account_uuid=charge_account_uuid,
        charge_account_code="681" if charge_account_uuid else None,
        charge_account=_fake_account("681" if charge_account_uuid else None),
        revenue_account_uuid=revenue_account_uuid,
        revenue_account_code="7062" if revenue_account_uuid else None,
        revenue_account=_fake_account("7062" if revenue_account_uuid else None),
        updated_at=datetime.now(timezone.utc),
    )


def _fake_asset(*, family, overrides=None):
    overrides = overrides or {}
    base = dict(
        uuid=uuid4(),
        asset_family_uuid=family.uuid,
        asset_family=family,
        parent_asset_uuid=None,
        parent_asset=None,
        code="F-CGVX",
        name="Pegase F-CGVX",
        registration="F-CGVX",
        serial_number=None,
        manufacturer=None,
        model=None,
        year_of_manufacture=None,
        ownership=1,
        private_owner_links=[],
        status=1,
        is_bookable=True,
        acquisition_account_uuid=None,
        acquisition_account=None,
        depreciation_account_uuid=None,
        depreciation_account=None,
        charge_account_uuid=None,
        charge_account=None,
        revenue_account_uuid=None,
        revenue_account=None,
        accounting_account_code_snapshot=None,
        purchase_date=None,
        purchase_price=None,
        depreciation_start_date=None,
        depreciation_years=None,
        residual_value=None,
        useful_life_years=None,
        notes=None,
        is_active=True,
        osrt_sync_enabled=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class AssetSchemaDefaultsTests(IsolatedAsyncioTestCase):
    def test_asset_family_create_defaults_is_priced_true(self):
        request = AssetFamilyCreateRequest(code="RMQ", name="Remorques")
        self.assertTrue(request.is_priced)

    def test_asset_create_defaults_is_bookable_true(self):
        request = AssetCreateRequest(asset_family_uuid=uuid4(), code="F-X", name="X")
        self.assertTrue(request.is_bookable)
        self.assertIsNone(request.parent_asset_uuid)


class ParentAssetValidationTests(IsolatedAsyncioTestCase):
    async def test_valid_top_level_parent_succeeds(self):
        db = _FakeDb(execute_results=[_FakeResult([(None,)])])
        await _validate_parent_asset_uuid(db, uuid4())  # no exception raised

    async def test_nonexistent_parent_raises_404(self):
        db = _FakeDb(execute_results=[_FakeResult([])])
        with self.assertRaises(HTTPException) as cm:
            await _validate_parent_asset_uuid(db, uuid4())
        self.assertEqual(cm.exception.status_code, 404)

    async def test_grandchild_attempt_raises_409(self):
        grandparent_uuid = uuid4()
        db = _FakeDb(execute_results=[_FakeResult([(grandparent_uuid,)])])
        with self.assertRaises(HTTPException) as cm:
            await _validate_parent_asset_uuid(db, uuid4())
        self.assertEqual(cm.exception.status_code, 409)

    async def test_self_reference_raises_409(self):
        self_uuid = uuid4()
        db = _FakeDb()
        with self.assertRaises(HTTPException) as cm:
            await _validate_parent_asset_uuid(db, self_uuid, self_uuid=self_uuid)
        self.assertEqual(cm.exception.status_code, 409)

    async def test_cannot_become_child_if_already_has_children(self):
        self_uuid = uuid4()
        new_parent_uuid = uuid4()
        db = _FakeDb(
            execute_results=[
                _FakeResult([(None,)]),  # candidate parent is itself top-level: OK
                _FakeResult([(uuid4(),)]),  # self_uuid already has >=1 child
            ]
        )
        with self.assertRaises(HTTPException) as cm:
            await _validate_parent_asset_uuid(db, new_parent_uuid, self_uuid=self_uuid)
        self.assertEqual(cm.exception.status_code, 409)

    async def test_detach_direction_update_succeeds(self):
        # An asset with children, itself top-level, may attach a NEW top-level parent
        # only if it has no children of its own — verify the reverse (valid) case.
        self_uuid = uuid4()
        new_parent_uuid = uuid4()
        db = _FakeDb(
            execute_results=[
                _FakeResult([(None,)]),  # candidate parent is top-level
                _FakeResult([]),  # self_uuid has no children
            ]
        )
        await _validate_parent_asset_uuid(db, new_parent_uuid, self_uuid=self_uuid)  # no exception


class GlAccountValidationTests(IsolatedAsyncioTestCase):
    async def test_family_gl_accounts_noop_when_all_none(self):
        db = _FakeDb()
        await _assert_family_gl_accounts_exist(db, {"acquisition_account_uuid": None})  # no exception

    async def test_family_gl_account_raises_422_for_unknown_uuid(self):
        db = _FakeDb(execute_results=[_FakeResult([])])
        with self.assertRaises(HTTPException) as cm:
            await _assert_family_gl_accounts_exist(db, {"acquisition_account_uuid": uuid4()})
        self.assertEqual(cm.exception.status_code, 422)

    async def test_family_gl_account_accepts_existing_uuid(self):
        db = _FakeDb(execute_results=[_FakeResult(["21821"])])
        await _assert_family_gl_accounts_exist(db, {"acquisition_account_uuid": uuid4()})  # no exception

    async def test_asset_gl_account_raises_422_for_unknown_uuid(self):
        db = _FakeDb(execute_results=[_FakeResult([])])
        with self.assertRaises(HTTPException) as cm:
            await _assert_asset_gl_accounts_exist(db, {"depreciation_account_uuid": uuid4()})
        self.assertEqual(cm.exception.status_code, 422)


class EffectiveAccountResolutionTests(IsolatedAsyncioTestCase):
    def test_no_override_uses_family_defaults(self):
        family = _fake_family(
            acquisition_account_uuid=uuid4(),
            depreciation_account_uuid=uuid4(),
            charge_account_uuid=uuid4(),
            revenue_account_uuid=uuid4(),
        )
        asset = _fake_asset(family=family)

        response = _serialize_asset(asset)

        self.assertEqual(response.effective_acquisition_account_uuid, family.acquisition_account_uuid)
        self.assertEqual(response.effective_acquisition_account_code, "21821")
        self.assertEqual(response.effective_depreciation_account_code, "281821")
        self.assertIsNone(response.acquisition_account_uuid)  # raw override stays null

    def test_partial_override_only_affects_that_account(self):
        family = _fake_family(
            acquisition_account_uuid=uuid4(),
            depreciation_account_uuid=uuid4(),
            charge_account_uuid=uuid4(),
            revenue_account_uuid=uuid4(),
        )
        override_uuid = uuid4()
        asset = _fake_asset(
            family=family,
            overrides={
                "charge_account_uuid": override_uuid,
                "charge_account": _fake_account("615"),
            },
        )

        response = _serialize_asset(asset)

        self.assertEqual(response.effective_charge_account_uuid, override_uuid)
        self.assertEqual(response.effective_charge_account_code, "615")
        # Other 3 accounts still fall back to family defaults
        self.assertEqual(response.effective_acquisition_account_uuid, family.acquisition_account_uuid)
        self.assertEqual(response.effective_revenue_account_uuid, family.revenue_account_uuid)

    def test_full_override_ignores_family_defaults(self):
        family = _fake_family(
            acquisition_account_uuid=uuid4(),
            depreciation_account_uuid=uuid4(),
            charge_account_uuid=uuid4(),
            revenue_account_uuid=uuid4(),
        )
        acq, dep, chg, rev = uuid4(), uuid4(), uuid4(), uuid4()
        asset = _fake_asset(
            family=family,
            overrides={
                "acquisition_account_uuid": acq,
                "acquisition_account": _fake_account("2182"),
                "depreciation_account_uuid": dep,
                "depreciation_account": _fake_account("28182"),
                "charge_account_uuid": chg,
                "charge_account": _fake_account("615"),
                "revenue_account_uuid": rev,
                "revenue_account": _fake_account("7063"),
            },
        )

        response = _serialize_asset(asset)

        self.assertEqual(response.effective_acquisition_account_uuid, acq)
        self.assertEqual(response.effective_depreciation_account_uuid, dep)
        self.assertEqual(response.effective_charge_account_uuid, chg)
        self.assertEqual(response.effective_revenue_account_uuid, rev)
        self.assertEqual(response.effective_acquisition_account_code, "2182")

    def test_child_asset_exposes_parent_code_and_name(self):
        family = _fake_family()
        parent = SimpleNamespace(code="F-CGVX", name="Pegase F-CGVX")
        child = _fake_asset(
            family=family,
            overrides={
                "code": "F-CGVX-REM",
                "name": "Remorque F-CGVX",
                "parent_asset_uuid": uuid4(),
                "parent_asset": parent,
                "is_bookable": False,
            },
        )

        response = _serialize_asset(child)

        self.assertEqual(response.parent_asset_code, "F-CGVX")
        self.assertEqual(response.parent_asset_name, "Pegase F-CGVX")
        self.assertFalse(response.is_bookable)


class ListChildAssetsTests(IsolatedAsyncioTestCase):
    async def test_returns_empty_list_when_no_children(self):
        db = _FakeDb(execute_results=[_FakeResult([])])
        children = await list_child_assets(db, uuid4())
        self.assertEqual(children, [])

    async def test_returns_children_as_child_response(self):
        family = _fake_family()
        child_model = SimpleNamespace(
            uuid=uuid4(),
            code="F-CGVX-REM",
            name="Remorque F-CGVX",
            purchase_price=None,
            status=1,
            is_bookable=False,
        )
        db = _FakeDb(execute_results=[_FakeResult([child_model])])

        children = await list_child_assets(db, uuid4())

        self.assertEqual(len(children), 1)
        self.assertEqual(children[0].code, "F-CGVX-REM")
        self.assertFalse(children[0].is_bookable)
