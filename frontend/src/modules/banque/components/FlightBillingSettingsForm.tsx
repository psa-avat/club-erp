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
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useMemberOptionsQuery } from '../../members/api'
import {
  useAccountsQuery,
  useFlightBillingSettingsDefaultsQuery,
  useFlightBillingSettingsQuery,
  useJournalsQuery,
  useUpsertFlightBillingSettingsMutation,
  type FlightBillingSettingsUpdate,
} from '../api'

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
  const upsertMutation = useUpsertFlightBillingSettingsMutation()

  const isLoading = loadingSettings || loadingDefaults

  // Form state
  const [flJournal, setFlJournal] = useState('')
  const [receivableAccount, setReceivableAccount] = useState('')
  const [vtJournal, setVtJournal] = useState('')
  const [packSalesAccount, setPackSalesAccount] = useState('')
  const [remJournal, setRemJournal] = useState('')
  const [discountExpenseAccount, setDiscountExpenseAccount] = useState('')
  const [initiationChargeAccount, setInitiationChargeAccount] = useState('')
  const [clubMember, setClubMember] = useState('')
  const [remPeriodDays, setRemPeriodDays] = useState(30)
  const [allowPostPurchaseRecalc, setAllowPostPurchaseRecalc] = useState(true)
  const [maxDaysDiscount, setMaxDaysDiscount] = useState(30)
  const [requireApprovalLate, setRequireApprovalLate] = useState(true)
  const [saved, setSaved] = useState(false)

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
      setClubMember(settings.club_member_uuid ?? '')
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
      setClubMember(defaults.club_member_uuid ?? '')
      setRemPeriodDays(defaults.rem_period_days)
      setAllowPostPurchaseRecalc(defaults.allow_post_purchase_recalculation)
      setMaxDaysDiscount(defaults.max_days_for_post_purchase_discount)
      setRequireApprovalLate(defaults.require_approval_for_late_discount)
    }
  }, [settings, defaults])

  // Journal, account & member options for SearchableSelect
  const journalOptions = useMemo(
    () => (journals ?? []).map((j) => ({ value: j.uuid, label: `${j.code} — ${j.name}` })),
    [journals],
  )
  const accountOptions = useMemo(
    () => (accounts ?? []).map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` })),
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
      club_member_uuid: clubMember || null,
      rem_period_days: remPeriodDays,
      allow_post_purchase_recalculation: allowPostPurchaseRecalc,
      max_days_for_post_purchase_discount: maxDaysDiscount,
      require_approval_for_late_discount: requireApprovalLate,
    }
    upsertMutation.mutate(payload, {
      onSuccess: () => setSaved(true),
    })
  }

  function handleReset() {
    if (!defaults) return
    setFlJournal(defaults.fl_journal_uuid ?? '')
    setReceivableAccount(defaults.receivable_account_uuid ?? '')
    setVtJournal(defaults.vt_journal_uuid ?? '')
    setPackSalesAccount(defaults.default_pack_sales_account_uuid ?? '')
    setRemJournal(defaults.rem_journal_uuid ?? '')
    setDiscountExpenseAccount(defaults.default_pack_discount_expense_account_uuid ?? '')
    setClubMember(defaults.club_member_uuid ?? '')
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

      {/* Club billing */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">{t('settings.flightBilling.clubTitle', 'Facturation club')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('settings.flightBilling.clubHelp', 'Compte de charge par défaut pour les vols facturés au club (initiations VI). Utilisé quand le type VI na pas de compte défini.')}</p>
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
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">{t('settings.flightBilling.clubMember', 'Membre représentant le club')}</Label>
            <SearchableSelect
              options={memberOptionsForSelect}
              value={clubMember}
              onChange={setClubMember}
              placeholder={t('settings.flightBilling.selectMember', 'Sélectionner un membre…')}
              clearable
            />
          </div>
        </div>
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
        <Button onClick={handleSave} disabled={!canSave || upsertMutation.isPending}>
          {upsertMutation.isPending ? t('settings.saving') : t('settings.save')}
        </Button>
        <Button variant="secondary" onClick={handleReset}>
          {t('settings.flightBilling.resetDefaults', 'Réinitialiser')}
        </Button>
      </div>
    </div>
  )
}
