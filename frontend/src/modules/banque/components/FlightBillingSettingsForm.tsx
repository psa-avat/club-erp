/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Flight billing settings form — typed journal-account pairs UI
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
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useMemberOptionsQuery } from '../../members/api'
import {
  useAccountsQuery,
  useFlightBillingSettingsDefaultsQuery,
  useFlightBillingSettingsQuery,
  useFlightTypeBillingAccountsQuery,
  useJournalsQuery,
  useUpsertFlightBillingSettingsMutation,
  useUpsertFlightTypeBillingAccountsMutation,
  type FlightBillingSettingsUpdate,
  type FlightTypeBillingAccountUpsert,
} from '../api'

// FlightBillingCategory enum values — backend/models.py FlightBillingCategory
const BILLING_CATEGORY_CLUB = 1
const BILLING_CATEGORY_ENTRAINEMENT = 2
const BILLING_CATEGORY_ESSAI = 3

type TypeAccountRow = {
  member: string
  analyticalCostAccount: string
  analyticalReflectionAccount: string
}

const EMPTY_TYPE_ACCOUNT_ROW: TypeAccountRow = {
  member: '',
  analyticalCostAccount: '',
  analyticalReflectionAccount: '',
}

// ── Helpers ──────────────────────────────────────────────────────────────

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    const detail = response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
  }
  return 'Erreur inattendue'
}

// ── Props ────────────────────────────────────────────────────────────────

interface FlightBillingSettingsFormProps {
  fiscalYearUuid: string
}

// ── Component ────────────────────────────────────────────────────────────

export function FlightBillingSettingsForm({ fiscalYearUuid }: FlightBillingSettingsFormProps) {
  const { t } = useTranslation('banque')

  const { data: settings, isLoading: loadingSettings, error: loadError } = useFlightBillingSettingsQuery(fiscalYearUuid, !!fiscalYearUuid)
  const { data: defaults, isLoading: loadingDefaults } = useFlightBillingSettingsDefaultsQuery(fiscalYearUuid, !!fiscalYearUuid)
  const { data: journals } = useJournalsQuery(true)
  const { data: accounts } = useAccountsQuery(true)
  const { data: memberOptions } = useMemberOptionsQuery()
  const { data: typeAccounts, isLoading: loadingTypeAccounts } = useFlightTypeBillingAccountsQuery(fiscalYearUuid, !!fiscalYearUuid)
  const upsertMutation = useUpsertFlightBillingSettingsMutation()
  const upsertTypeAccountsMutation = useUpsertFlightTypeBillingAccountsMutation()

  const isLoading = loadingSettings || loadingDefaults || loadingTypeAccounts

  // Form state
  const [flJournal, setFlJournal] = useState('')
  const [receivableAccount, setReceivableAccount] = useState('')
  const [vtJournal, setVtJournal] = useState('')
  const [packSalesAccount, setPackSalesAccount] = useState('')
  const [remJournal, setRemJournal] = useState('')
  const [discountExpenseAccount, setDiscountExpenseAccount] = useState('')
  const [initiationChargeAccount, setInitiationChargeAccount] = useState('')
  const [clubAccounts, setClubAccounts] = useState<TypeAccountRow>(EMPTY_TYPE_ACCOUNT_ROW)
  const [entrainementAccounts, setEntrainementAccounts] = useState<TypeAccountRow>(EMPTY_TYPE_ACCOUNT_ROW)
  const [essaiAccounts, setEssaiAccounts] = useState<TypeAccountRow>(EMPTY_TYPE_ACCOUNT_ROW)
  const [remPeriodDays, setRemPeriodDays] = useState(30)
  const [allowPostPurchaseRecalc, setAllowPostPurchaseRecalc] = useState(true)
  const [maxDaysDiscount, setMaxDaysDiscount] = useState(30)
  const [requireApprovalLate, setRequireApprovalLate] = useState(true)
  const [saved, setSaved] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Initialize form from saved settings or defaults
  useEffect(() => {
    if (settings) {
      setFlJournal(settings.fl_journal_uuid)
      setReceivableAccount(settings.receivable_account_uuid)
      setVtJournal(settings.vt_journal_uuid)
      setPackSalesAccount(settings.default_pack_sales_account_uuid ?? '')
      setRemJournal(settings.rem_journal_uuid)
      setDiscountExpenseAccount(settings.default_pack_discount_expense_account_uuid ?? '')
      setInitiationChargeAccount(settings.default_initiation_charge_account_uuid ?? '')
      setRemPeriodDays(settings.rem_period_days)
      setAllowPostPurchaseRecalc(settings.allow_post_purchase_recalculation)
      setMaxDaysDiscount(settings.max_days_for_post_purchase_discount ?? 30)
      setRequireApprovalLate(settings.require_approval_for_late_discount)
    } else if (defaults && !settings) {
      setFlJournal(defaults.fl_journal_uuid ?? '')
      setReceivableAccount(defaults.receivable_account_uuid ?? '')
      setVtJournal(defaults.vt_journal_uuid ?? '')
      setPackSalesAccount(defaults.default_pack_sales_account_uuid ?? '')
      setRemJournal(defaults.rem_journal_uuid ?? '')
      setDiscountExpenseAccount(defaults.default_pack_discount_expense_account_uuid ?? '')
      setInitiationChargeAccount(defaults.default_initiation_charge_account_uuid ?? '')
      setRemPeriodDays(defaults.rem_period_days)
      setAllowPostPurchaseRecalc(defaults.allow_post_purchase_recalculation)
      setMaxDaysDiscount(defaults.max_days_for_post_purchase_discount)
      setRequireApprovalLate(defaults.require_approval_for_late_discount)
    }
  }, [settings, defaults])

  // Initialize per-billing-category accounts (club / entrainement / essai) from saved rows
  useEffect(() => {
    if (!typeAccounts) return
    const toRow = (category: number): TypeAccountRow => {
      const row = typeAccounts.find((r) => r.billing_category === category)
      return {
        member: row?.member_uuid ?? '',
        analyticalCostAccount: row?.analytical_cost_account_uuid ?? '',
        analyticalReflectionAccount: row?.analytical_reflection_account_uuid ?? '',
      }
    }
    setClubAccounts(toRow(BILLING_CATEGORY_CLUB))
    setEntrainementAccounts(toRow(BILLING_CATEGORY_ENTRAINEMENT))
    setEssaiAccounts(toRow(BILLING_CATEGORY_ESSAI))
  }, [typeAccounts])

  // Journal, account & member options for SearchableSelect
  const journalOptions = useMemo(
    () => (journals ?? []).map((j) => ({ value: j.uuid, label: `${j.code} — ${j.name}` })),
    [journals],
  )
  const accountOptions = useMemo(
    () => (accounts ?? []).map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` })),
    [accounts],
  )
  // Analytical (class 9) accounts for the per-flight-type cost/reflection pickers
  const analyticalAccountOptions = useMemo(
    () =>
      (accounts ?? [])
        .filter((a) => a.is_posting_allowed && a.code.startsWith('9'))
        .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` })),
    [accounts],
  )
  const memberLabel = (m: { uuid: string; account_id: string; first_name: string; last_name: string }) =>
    `${m.account_id} — ${m.first_name} ${m.last_name}`
  const memberOptionsForSelect = useMemo(
    () => (memberOptions ?? []).map((m) => ({ value: m.uuid, label: memberLabel(m) })),
    [memberOptions],
  )

  const canSave = flJournal && receivableAccount && vtJournal && remJournal

  async function handleSave() {
    if (!canSave || !fiscalYearUuid) return
    setSaved(false)
    const payload: FlightBillingSettingsUpdate = {
      fiscal_year_uuid: fiscalYearUuid,
      fl_journal_uuid: flJournal,
      receivable_account_uuid: receivableAccount,
      vt_journal_uuid: vtJournal,
      default_pack_sales_account_uuid: packSalesAccount || null,
      rem_journal_uuid: remJournal,
      default_pack_discount_expense_account_uuid: discountExpenseAccount || null,
      default_initiation_charge_account_uuid: initiationChargeAccount || null,
      rem_period_days: remPeriodDays,
      allow_post_purchase_recalculation: allowPostPurchaseRecalc,
      max_days_for_post_purchase_discount: maxDaysDiscount,
      require_approval_for_late_discount: requireApprovalLate,
    }
    upsertMutation.mutate(payload, {
      onSuccess: () => setSaved(true),
    })

    const typeAccountRows: FlightTypeBillingAccountUpsert[] = [
      {
        billing_category: BILLING_CATEGORY_CLUB,
        member_uuid: clubAccounts.member || null,
        analytical_cost_account_uuid: clubAccounts.analyticalCostAccount || null,
        analytical_reflection_account_uuid: clubAccounts.analyticalReflectionAccount || null,
      },
      {
        billing_category: BILLING_CATEGORY_ENTRAINEMENT,
        member_uuid: entrainementAccounts.member || null,
        analytical_cost_account_uuid: entrainementAccounts.analyticalCostAccount || null,
        analytical_reflection_account_uuid: entrainementAccounts.analyticalReflectionAccount || null,
      },
      {
        billing_category: BILLING_CATEGORY_ESSAI,
        member_uuid: essaiAccounts.member || null,
        analytical_cost_account_uuid: essaiAccounts.analyticalCostAccount || null,
        analytical_reflection_account_uuid: essaiAccounts.analyticalReflectionAccount || null,
      },
    ]
    upsertTypeAccountsMutation.mutate({ fiscal_year_uuid: fiscalYearUuid, accounts: typeAccountRows })
  }

  function handleReset() {
    if (!defaults) return
    setFlJournal(defaults.fl_journal_uuid ?? '')
    setReceivableAccount(defaults.receivable_account_uuid ?? '')
    setVtJournal(defaults.vt_journal_uuid ?? '')
    setPackSalesAccount(defaults.default_pack_sales_account_uuid ?? '')
    setRemJournal(defaults.rem_journal_uuid ?? '')
    setDiscountExpenseAccount(defaults.default_pack_discount_expense_account_uuid ?? '')
    setInitiationChargeAccount(defaults.default_initiation_charge_account_uuid ?? '')
    setClubAccounts(EMPTY_TYPE_ACCOUNT_ROW)
    setEntrainementAccounts(EMPTY_TYPE_ACCOUNT_ROW)
    setEssaiAccounts(EMPTY_TYPE_ACCOUNT_ROW)
    setRemPeriodDays(defaults.rem_period_days)
    setAllowPostPurchaseRecalc(defaults.allow_post_purchase_recalculation)
    setMaxDaysDiscount(defaults.max_days_for_post_purchase_discount)
    setRequireApprovalLate(defaults.require_approval_for_late_discount)
  }

  if (isLoading) {
    return <p className="text-sm text-slate-500">{t('settings.loading')}</p>
  }

  return (
    <div className="space-y-6">
      {loadError && <Alert>{toErrorMessage(loadError)}</Alert>}
      {upsertMutation.error && <Alert>{toErrorMessage(upsertMutation.error)}</Alert>}
      {upsertTypeAccountsMutation.error && <Alert>{toErrorMessage(upsertTypeAccountsMutation.error)}</Alert>}
      {saved && <Alert><p className="text-sm text-emerald-700">{t('settings.saved', 'Paramètres enregistrés')}</p></Alert>}

      {/* FL — Vols */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">FL — {t('settings.flightBilling.flCardTitle', 'Vols (facturation)')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('settings.flightBilling.flCardHelp', 'Les écritures de vol seront postées dans ce journal au débit du compte client')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.flJournal', 'Journal FL')}</Label>
            <SearchableSelect
              options={journalOptions}
              value={flJournal}
              onChange={setFlJournal}
              placeholder={t('settings.flightBilling.selectJournal', 'Sélectionner un journal…')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.receivableAccount', 'Compte client (411)')}</Label>
            <SearchableSelect
              options={accountOptions}
              value={receivableAccount}
              onChange={setReceivableAccount}
              placeholder={t('settings.flightBilling.selectAccount', 'Sélectionner un compte…')}
            />
          </div>
        </div>
      </div>

      {/* VT — Ventes */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">VT — {t('settings.flightBilling.vtCardTitle', 'Ventes (forfaits)')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('settings.flightBilling.vtCardHelp', 'Les achats de forfaits seront postés dans ce journal au crédit du compte de vente')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.vtJournal', 'Journal VT')}</Label>
            <SearchableSelect
              options={journalOptions}
              value={vtJournal}
              onChange={setVtJournal}
              placeholder={t('settings.flightBilling.selectJournal', 'Sélectionner un journal…')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.packSalesAccount', 'Compte vente forfaits (classe 7)')}</Label>
            <SearchableSelect
              options={accountOptions}
              value={packSalesAccount}
              onChange={setPackSalesAccount}
              placeholder={t('settings.flightBilling.selectAccount', 'Sélectionner un compte…')}
              clearable
            />
          </div>
        </div>
      </div>

      {/* REM — Remises */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">REM — {t('settings.flightBilling.remCardTitle', 'Remises')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('settings.flightBilling.remCardHelp', 'Les remises de forfaits seront postées dans ce journal au débit du compte de charge')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.remJournal', 'Journal REM')}</Label>
            <SearchableSelect
              options={journalOptions}
              value={remJournal}
              onChange={setRemJournal}
              placeholder={t('settings.flightBilling.selectJournal', 'Sélectionner un journal…')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.discountExpenseAccount', 'Compte charge remises (classe 6)')}</Label>
            <SearchableSelect
              options={accountOptions}
              value={discountExpenseAccount}
              onChange={setDiscountExpenseAccount}
              placeholder={t('settings.flightBilling.selectAccount', 'Sélectionner un compte…')}
              clearable
            />
          </div>
        </div>
      </div>

      {/* Initiation fallback — unrelated to club/entrainement/essai, kept visually separate */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">{t('settings.flightBilling.initiationTitle', 'Initiation (repli)')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('settings.flightBilling.initiationHelp', "Compte de repli utilisé uniquement pour les vols d'initiation sans type VI configuré.")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.initiationChargeAccount', 'Compte charge initiation (classe 6)')}</Label>
            <SearchableSelect
              options={accountOptions}
              value={initiationChargeAccount}
              onChange={setInitiationChargeAccount}
              placeholder={t('settings.flightBilling.selectAccount', 'Sélectionner un compte…')}
              clearable
            />
            <p className="text-[10px] text-slate-400">{t('settings.flightBilling.initiationChargeAccountHelp', 'Fallback pour les initiations sans type VI')}</p>
          </div>
        </div>
      </div>

      {/* Facturation club — one self-contained frame per category: sentinel member + analytical accounts */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">{t('settings.flightBilling.clubTitle', 'Facturation club')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('settings.flightBilling.typeAccountsHelp', "Chaque catégorie regroupe son membre sentinelle et ses comptes analytiques (classe 9) — toujours analytique, pas de repli en classe 6.")}</p>

        {([
          { label: t('settings.flightBilling.clubRowLabel', 'Club'), row: clubAccounts, setRow: setClubAccounts },
          { label: t('settings.flightBilling.entrainementRowLabel', 'Entraînement'), row: entrainementAccounts, setRow: setEntrainementAccounts },
          { label: t('settings.flightBilling.essaiRowLabel', 'Essai'), row: essaiAccounts, setRow: setEssaiAccounts },
        ] as const).map(({ label, row, setRow }) => (
          <div key={label} className="mt-3 rounded-lg border border-slate-100 p-3">
            <p className="text-xs font-semibold text-slate-700">{label}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.categoryMemberLabel', 'Membre sentinelle')}</Label>
                <SearchableSelect
                  options={memberOptionsForSelect}
                  value={row.member}
                  onChange={(value) => setRow({ ...row, member: value })}
                  placeholder={t('settings.flightBilling.selectMember', 'Sélectionner un membre…')}
                  clearable
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.analyticalCostAccountLabel', 'Compte de coût analytique')}</Label>
                <SearchableSelect
                  options={analyticalAccountOptions}
                  value={row.analyticalCostAccount}
                  onChange={(value) => setRow({ ...row, analyticalCostAccount: value })}
                  placeholder={t('settings.flightBilling.selectAccount', 'Sélectionner un compte…')}
                  clearable
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.analyticalReflectionAccountLabel', 'Compte de reflet analytique')}</Label>
                <SearchableSelect
                  options={analyticalAccountOptions}
                  value={row.analyticalReflectionAccount}
                  onChange={(value) => setRow({ ...row, analyticalReflectionAccount: value })}
                  placeholder={t('settings.flightBilling.selectAccount', 'Sélectionner un compte…')}
                  clearable
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Operational settings */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">{t('settings.flightBilling.operationalTitle', 'Paramètres opérationnels')}</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.remPeriodDays', 'Période REM (jours)')}</Label>
            <Input type="number" min={1} value={remPeriodDays} onChange={(e) => setRemPeriodDays(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.maxDaysDiscount', 'Max jours recalcul')}</Label>
            <Input type="number" min={1} value={maxDaysDiscount} onChange={(e) => setMaxDaysDiscount(Number(e.target.value))} />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              id="allow-recalc"
              className="h-4 w-4 rounded border-slate-300"
              checked={allowPostPurchaseRecalc}
              onChange={(e) => setAllowPostPurchaseRecalc(e.target.checked)}
            />
            <Label htmlFor="allow-recalc" className="text-xs font-medium text-slate-700 cursor-pointer">
              {t('settings.flightBilling.allowRecalc', 'Recalcul post-achat')}
            </Label>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              id="require-approval"
              className="h-4 w-4 rounded border-slate-300"
              checked={requireApprovalLate}
              onChange={(e) => setRequireApprovalLate(e.target.checked)}
            />
            <Label htmlFor="require-approval" className="text-xs font-medium text-slate-700 cursor-pointer">
              {t('settings.flightBilling.requireApproval', 'Approbation req. retard')}
            </Label>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={!canSave || upsertMutation.isPending || upsertTypeAccountsMutation.isPending}>
          {upsertMutation.isPending || upsertTypeAccountsMutation.isPending ? t('settings.saving') : t('settings.save')}
        </Button>
        <Button variant="secondary" onClick={() => setShowResetConfirm(true)}>
          {t('settings.flightBilling.resetDefaults', 'Réinitialiser')}
        </Button>
      </div>

      <ConfirmDialog
        open={showResetConfirm}
        title={t('settings.flightBilling.resetConfirmTitle', 'Réinitialiser la configuration')}
        body={t('settings.flightBilling.resetConfirmBody', 'Cette action va réinitialiser tous les paramètres aux valeurs par défaut. Les paramètres actuels seront perdus.')}
        confirmLabel={t('settings.flightBilling.resetDefaults', 'Réinitialiser')}
        cancelLabel={t('common.cancel', 'Annuler')}
        variant="destructive"
        onConfirm={() => { setShowResetConfirm(false); handleReset() }}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  )
}
