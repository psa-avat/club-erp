/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Asset create/edit form with decimal-safe monetary fields
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
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AxiosError } from 'axios'
import Decimal from 'decimal.js'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useAccountsQuery } from '../../banque/api'
import { useMemberOptionsQuery } from '../../members/api'
import type { MemberOption } from '../../members/types'
import {
  useAssetQuery,
  useAssetTypesQuery,
  useCreateAssetMutation,
  useUpdateAssetMutation,
} from '../api'
import type { CreateAssetPayload } from '../types'

// �"?�"? Constants �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

const OWNERSHIP_CLUB = 1
const OWNERSHIP_PRIVATE = 2

// �"?�"? Helpers �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

function isValidDecimal(value: string): boolean {
  if (!value.trim()) return true
  try {
    const d = new Decimal(value)
    return d.isFinite() && d.greaterThanOrEqualTo(0)
  } catch {
    return false
  }
}

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

// �"?�"? Form State �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

type FormState = {
  code: string
  name: string
  asset_type_uuid: string
  registration: string
  serial_number: string
  manufacturer: string
  model: string
  year_of_manufacture: string
  ownership: number
  owner_member_uuids: string[]
  acquisition_account_uuid: string
  purchase_date: string
  purchase_price: string
  depreciation_start_date: string
  depreciation_duration_months: string
  residual_value: string
  osrt_sync_enabled: boolean
}

const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  asset_type_uuid: '',
  registration: '',
  serial_number: '',
  manufacturer: '',
  model: '',
  year_of_manufacture: '',
  ownership: OWNERSHIP_CLUB,
  owner_member_uuids: [],
  acquisition_account_uuid: '',
  purchase_date: '',
  purchase_price: '',
  depreciation_start_date: '',
  depreciation_duration_months: '',
  residual_value: '',
  osrt_sync_enabled: false,
}

// �"?�"? Decimal Input �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

function DecimalInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}) {
  const invalid = value !== '' && !isValidDecimal(value)
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '0.0000'}
        className={`h-8 text-sm font-mono ${invalid ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
      />
      {invalid && (
        <p className="text-xs text-red-600">Valeur décimale invalide</p>
      )}
    </div>
  )
}

// �"?�"? Main Component �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

export function AssetFormPage() {
  const { t } = useTranslation('assets')
  const navigate = useNavigate()
  const { uuid } = useParams<{ uuid?: string }>()
  const isEdit = Boolean(uuid) && uuid !== 'new'

  const canManage = useCapability('MANAGE_ASSETS')

  const typesQuery = useAssetTypesQuery(canManage)
  const assetQuery = useAssetQuery(isEdit ? (uuid ?? null) : null)
  const accountsQuery = useAccountsQuery(canManage)
  const [ownerSearch, setOwnerSearch] = useState('')
  const memberOptionsQuery = useMemberOptionsQuery({ search: ownerSearch, limit: 50 })

  const createMutation = useCreateAssetMutation()
  const updateMutation = useUpdateAssetMutation(uuid ?? '')

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Populate form when editing
  useEffect(() => {
    const asset = assetQuery.data
    if (!asset) return
    setForm({
      code: asset.code,
      name: asset.name,
      asset_type_uuid: asset.asset_type_uuid,
      registration: asset.registration ?? '',
      serial_number: asset.serial_number ?? '',
      manufacturer: asset.manufacturer ?? '',
      model: asset.model ?? '',
      year_of_manufacture: asset.year_of_manufacture ? String(asset.year_of_manufacture) : '',
      ownership: asset.ownership,
      owner_member_uuids: asset.owner_member_uuids ?? [],
      acquisition_account_uuid: asset.acquisition_account_uuid ?? '',
      purchase_date: asset.purchase_date ?? '',
      purchase_price: asset.purchase_price ?? '',
      depreciation_start_date: asset.depreciation_start_date ?? '',
      depreciation_duration_months: asset.depreciation_duration_months
        ? String(asset.depreciation_duration_months)
        : '',
      residual_value: asset.residual_value ?? '',
      osrt_sync_enabled: asset.osrt_sync_enabled ?? false,
    })
  }, [assetQuery.data])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function buildPayload(): CreateAssetPayload {
    return {
      code: form.code.trim(),
      name: form.name.trim(),
      asset_type_uuid: form.asset_type_uuid,
      registration: form.registration.trim() || null,
      serial_number: form.serial_number.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      year_of_manufacture: form.year_of_manufacture ? Number(form.year_of_manufacture) : null,
      ownership: form.ownership,
      owner_member_uuids:
        form.ownership === OWNERSHIP_PRIVATE ? form.owner_member_uuids : [],
      acquisition_account_uuid: form.acquisition_account_uuid.trim() || null,
      purchase_date: form.purchase_date || null,
      purchase_price: form.purchase_price.trim() || null,
      depreciation_start_date: form.depreciation_start_date || null,
      depreciation_duration_months: form.depreciation_duration_months
        ? Number(form.depreciation_duration_months)
        : null,
      residual_value: form.residual_value.trim() || null,
      osrt_sync_enabled: form.osrt_sync_enabled,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    if (isPrivate && form.owner_member_uuids.length === 0) {
      setError(t('form.ownerRequired'))
      return
    }
    try {
      if (isEdit && uuid) {
        await updateMutation.mutateAsync(buildPayload())
        setSaved(true)
      } else {
        const created = await createMutation.mutateAsync(buildPayload())
        navigate(`/assets/${created.uuid}`)
      }
    } catch (err) {
      setError(extractError(err, t('error.saveFailed')))
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending
  const isPrivate = form.ownership === OWNERSHIP_PRIVATE
  const acquisitionAccounts = (accountsQuery.data ?? [])
    .filter((account) => account.code.startsWith('2') && account.is_posting_allowed)
    .sort((a, b) => a.code.localeCompare(b.code))
  const memberOptions = memberOptionsQuery.data ?? []
  const selectedOwnerMap = new Map<string, MemberOption>()
  for (const owner of assetQuery.data?.owner_members ?? []) {
    selectedOwnerMap.set(owner.uuid, owner)
  }
  for (const member of memberOptions) {
    selectedOwnerMap.set(member.uuid, member)
  }
  const selectedOwners = form.owner_member_uuids
    .map((memberUuid) => selectedOwnerMap.get(memberUuid))
    .filter((member): member is MemberOption => Boolean(member))

  function addOwner(memberUuid: string) {
    set('owner_member_uuids', form.owner_member_uuids.includes(memberUuid)
      ? form.owner_member_uuids
      : [...form.owner_member_uuids, memberUuid])
    setOwnerSearch('')
  }

  function removeOwner(memberUuid: string) {
    set('owner_member_uuids', form.owner_member_uuids.filter((uuid) => uuid !== memberUuid))
  }

  if (!canManage) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('noPermission')}</p>
      </section>
    )
  }

  if (isEdit && assetQuery.isLoading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('states.loading')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {isEdit ? t('form.editTitle') : t('form.createTitle')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t('form.description')}</p>
      </div>

      {error && (
        <Alert>
          <p className="text-sm">{error}</p>
        </Alert>
      )}
      {saved && (
        <Alert>
          <p className="text-sm">{t('form.savedSuccess')}</p>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Identity */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">{t('form.sectionIdentity')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="code" className="text-xs">
                {t('form.code')} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => set('code', e.target.value)}
                className="h-8 text-sm"
                required
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="name" className="text-xs">
                {t('form.name')} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className="h-8 text-sm"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="type" className="text-xs">
                {t('form.type')} <span className="text-red-500">*</span>
              </Label>
              <select
                id="type"
                value={form.asset_type_uuid}
                onChange={(e) => set('asset_type_uuid', e.target.value)}
                required
                className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">{t('form.selectType')}</option>
                {(typesQuery.data ?? []).map((ty) => (
                  <option key={ty.uuid} value={ty.uuid}>
                    {ty.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="registration" className="text-xs">{t('form.registrationNumber')}</Label>
              <Input
                id="registration"
                value={form.registration}
                onChange={(e) => set('registration', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="serial" className="text-xs">{t('form.serialNumber')}</Label>
              <Input
                id="serial"
                value={form.serial_number}
                onChange={(e) => set('serial_number', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="manufacturer" className="text-xs">{t('form.manufacturer')}</Label>
              <Input
                id="manufacturer"
                value={form.manufacturer}
                onChange={(e) => set('manufacturer', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="model" className="text-xs">{t('form.model')}</Label>
              <Input
                id="model"
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="year" className="text-xs">{t('form.yearOfManufacture')}</Label>
              <Input
                id="year"
                type="number"
                min={1900}
                max={new Date().getFullYear() + 2}
                value={form.year_of_manufacture}
                onChange={(e) => set('year_of_manufacture', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Ownership */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">{t('form.sectionOwnership')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ownership" className="text-xs">
                {t('form.ownership')} <span className="text-red-500">*</span>
              </Label>
              <select
                id="ownership"
                value={form.ownership}
                onChange={(e) => set('ownership', Number(e.target.value))}
                className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value={OWNERSHIP_CLUB}>{t('ownership.club')}</option>
                <option value={OWNERSHIP_PRIVATE}>{t('ownership.private')}</option>
              </select>
            </div>

            {isPrivate && (
              <div className="space-y-1">
                <Label htmlFor="owner-search" className="text-xs">
                  {t('form.ownerMembers')}
                  <span className="ml-0.5 text-red-500">*</span>
                </Label>
                <Input
                  id="owner-search"
                  value={ownerSearch}
                  onChange={(e) => setOwnerSearch(e.target.value)}
                  placeholder={t('form.ownerSearchPlaceholder')}
                  className="h-8 text-sm"
                />
                <p className="text-xs text-slate-500">{t('form.ownerHint')}</p>
                {selectedOwners.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedOwners.map((owner) => (
                      <span
                        key={owner.uuid}
                        className="inline-flex items-center gap-2 rounded-full bg-surface-container px-2.5 py-1 text-xs text-on-surface"
                      >
                        <span>{owner.first_name} {owner.last_name} · {owner.account_id}</span>
                        <button
                          type="button"
                          onClick={() => removeOwner(owner.uuid)}
                          className="text-on-surface-variant hover:text-on-surface"
                          aria-label={t('form.removeOwner')}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200">
                  {memberOptionsQuery.isLoading ? (
                    <p className="px-3 py-2 text-xs text-slate-500">{t('states.loading')}</p>
                  ) : memberOptions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-500">{t('form.noOwnerResults')}</p>
                  ) : (
                    memberOptions.map((member) => {
                      const isSelected = form.owner_member_uuids.includes(member.uuid)
                      return (
                        <button
                          key={member.uuid}
                          type="button"
                          onClick={() => addOwner(member.uuid)}
                          disabled={isSelected}
                          className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50 disabled:cursor-default disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          <span>{member.first_name} {member.last_name}</span>
                          <span className="text-xs text-slate-500">{member.account_id}</span>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Financial */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">{t('form.sectionFinancial')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="acqAccount" className="text-xs">{t('form.acquisitionAccountUuid')}</Label>
              <select
                id="acqAccount"
                value={form.acquisition_account_uuid}
                onChange={(e) => set('acquisition_account_uuid', e.target.value)}
                className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">{t('form.accountPlaceholder')}</option>
                {acquisitionAccounts.map((account) => (
                  <option key={account.uuid} value={account.uuid}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">{t('form.accountHint')}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchaseDate" className="text-xs">{t('form.purchaseDate')}</Label>
              <Input
                id="purchaseDate"
                type="date"
                value={form.purchase_date}
                onChange={(e) => set('purchase_date', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <DecimalInput
              id="purchasePrice"
              label={t('form.purchasePrice')}
              value={form.purchase_price}
              onChange={(v) => set('purchase_price', v)}
            />
            <div className="space-y-1">
              <Label htmlFor="deprStart" className="text-xs">{t('form.depreciationStartDate')}</Label>
              <Input
                id="deprStart"
                type="date"
                value={form.depreciation_start_date}
                onChange={(e) => set('depreciation_start_date', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deprMonths" className="text-xs">{t('form.depreciationMonths')}</Label>
              <Input
                id="deprMonths"
                type="number"
                min={1}
                value={form.depreciation_duration_months}
                onChange={(e) => set('depreciation_duration_months', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <DecimalInput
              id="residualValue"
              label={t('form.residualValue')}
              value={form.residual_value}
              onChange={(v) => set('residual_value', v)}
            />
          </div>
        </div>

        {/* Integrations */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">{t('form.sectionIntegrations')}</h2>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={form.osrt_sync_enabled}
              onChange={(e) => set('osrt_sync_enabled', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-slate-700"
            />
            <span className="text-sm text-slate-700">{t('form.osrtSyncEnabled')}</span>
          </label>
          <p className="mt-1 pl-7 text-xs text-slate-500">{t('form.osrtSyncEnabledHint')}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? t('actions.saving') : isEdit ? t('actions.saveChanges') : t('actions.create')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(isEdit ? `/assets/${uuid}` : '/assets')}
          >
            {t('actions.cancel')}
          </Button>
        </div>
      </form>
    </section>
  )
}
