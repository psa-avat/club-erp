/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - AssetFamilyPricingPanel: pricing version CRUD for one asset family (no FY dependency)
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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AxiosError } from 'axios'
import Decimal from 'decimal.js'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { Dialog, DialogContent } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  EMPTY_ITEM,
  UNIT_LABELS,
  PricingItemForm,
  buildItemPayload,
  itemToForm,
  type ItemFormState,
} from '../../banque/components/pricingShared'
import { useAccountsQuery } from '../../banque/api'
import {
  useAssetPricingVersionsQuery,
  useCreateAssetPricingVersionMutation,
  useUpdateAssetPricingVersionMutation,
  useDeleteAssetPricingVersionMutation,
  useCloneAssetPricingVersionMutation,
  usePricingItemsQuery,
  useCreatePricingItemMutation,
  useUpdatePricingItemMutation,
  useDeletePricingItemMutation,
  useFlightTypesQuery,
} from '../api'
import type { AssetPricingVersion, PricingItem } from '../types'

const VERSION_STATUS_DRAFT = 1
const VERSION_STATUS_ACTIVE = 2
const VERSION_STATUS_ARCHIVED = 3

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

function versionStatusClass(status: number): string {
  if (status === VERSION_STATUS_DRAFT) return 'bg-warning-container text-on-warning-container'
  if (status === VERSION_STATUS_ACTIVE) return 'bg-success-container text-on-success-container'
  return 'bg-surface-container text-on-surface-variant'
}

function formatPrice(value: string | null | undefined): string {
  if (!value) return '—'
  try { return new Decimal(value).toFixed(2) } catch { return value }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

// ── Version Badge ─────────────────────────────────────────────────────────────

function VersionBadge({ status, t }: { status: number; t: (k: string) => string }) {
  const label =
    status === VERSION_STATUS_DRAFT
      ? t('version.statusDraft')
      : status === VERSION_STATUS_ACTIVE
      ? t('version.statusActive')
      : t('version.statusArchived')
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${versionStatusClass(status)}`}>
      {label}
    </span>
  )
}

// ── Version Form ─────────────────────────────────────────────────────────────

type VersionFormState = {
  name: string
  from_date: string
  to_date: string
  status: number
  use_pack: boolean
}

function VersionForm({
  initial,
  onSave,
  onCancel,
  saving,
  t,
}: {
  initial: VersionFormState
  onSave: (v: VersionFormState) => void
  onCancel: () => void
  saving: boolean
  t: (k: string) => string
}) {
  const [form, setForm] = useState<VersionFormState>(initial)
  function set<K extends keyof VersionFormState>(key: K, value: VersionFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="grid gap-3 rounded-shape-md border border-outline-variant bg-surface-variant p-4 sm:grid-cols-4">
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">{t('version.name')}</Label>
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('version.fromDate')}</Label>
        <Input type="date" value={form.from_date} onChange={(e) => set('from_date', e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('version.toDate')}</Label>
        <Input type="date" value={form.to_date} onChange={(e) => set('to_date', e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="flex items-center gap-2 pt-4">
        <input
          id="use-pack"
          type="checkbox"
          checked={form.use_pack}
          onChange={(e) => set('use_pack', e.target.checked)}
          className="h-4 w-4 rounded border-outline"
        />
        <Label htmlFor="use-pack" className="text-xs">{t('version.usePack')}</Label>
        <span className="text-[11px] text-on-surface-variant">{t('version.usePackHelp')}</span>
      </div>
      <div className="flex items-end gap-2 sm:col-span-3">
        <Button className="h-8 rounded-md px-3 text-xs" onClick={() => onSave(form)} disabled={saving || !form.name || !form.from_date}>
          <Check className="mr-1 h-3 w-3" />
          {saving ? t('version.saving') : t('version.save')}
        </Button>
        <Button className="h-8 rounded-md bg-transparent px-3 text-xs text-on-surface hover:bg-surface-container" onClick={onCancel}>
          <X className="mr-1 h-3 w-3" />
          {t('version.cancel')}
        </Button>
      </div>
    </div>
  )
}

// ── Pricing Items Panel ───────────────────────────────────────────────────────

function PricingItemsPanel({
  version,
  canEdit,
  t,
}: {
  version: AssetPricingVersion
  canEdit: boolean
  t: (k: string) => string
}) {
  const itemsQuery = usePricingItemsQuery(version.uuid, true)
  const items = itemsQuery.data ?? []

  const flightTypesQuery = useFlightTypesQuery()
  const flightTypes = flightTypesQuery.data ?? []

  const accountsQuery = useAccountsQuery()
  const revenueAccounts = (accountsQuery.data ?? []).filter((a) => a.type === 5 && a.is_posting_allowed)

  const createMutation = useCreatePricingItemMutation(version.uuid)
  const updateMutation = useUpdatePricingItemMutation(version.uuid)
  const deleteMutation = useDeletePricingItemMutation(version.uuid)

  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<PricingItem | null>(null)
  const [itemError, setItemError] = useState<string | null>(null)
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<PricingItem | null>(null)

  async function handleCreate(form: ItemFormState) {
    try {
      await createMutation.mutateAsync(buildItemPayload(form, { isAssetScoped: true }))
      setShowForm(false)
      setItemError(null)
    } catch (e) {
      setItemError(extractError(e, t('error.saveFailed')))
    }
  }

  async function handleUpdate(form: ItemFormState) {
    if (!editingItem) return
    try {
      await updateMutation.mutateAsync({
        uuid: editingItem.uuid,
        ...buildItemPayload(form, { isAssetScoped: true }),
      })
      setEditingItem(null)
      setItemError(null)
    } catch (e) {
      setItemError(extractError(e, t('error.saveFailed')))
    }
  }

  async function handleDelete(item: PricingItem) {
    try {
      await deleteMutation.mutateAsync(item.uuid)
      setItemError(null)
    } catch (e) {
      setItemError(extractError(e, t('error.deleteFailed')))
    }
  }

  const editable = canEdit && !version.is_locked && version.status === VERSION_STATUS_DRAFT

  return (
    <div className="mt-4 space-y-3 border-t border-outline-variant pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-on-surface-variant">{t('items')}</h3>
        {editable && !showForm && !editingItem && (
          <Button className="h-8 rounded-md bg-transparent px-3 text-xs text-on-surface hover:bg-surface-container" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-3 w-3" />
            {t('addItem')}
          </Button>
        )}
      </div>

      {itemError && <p className="text-xs text-error">{itemError}</p>}

      {showForm && (
        <PricingItemForm
          initial={EMPTY_ITEM}
          flightTypes={flightTypes}
          revenueAccounts={revenueAccounts}
          isAssetScoped={true}
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
          saving={createMutation.isPending}
        />
      )}

      {itemsQuery.isLoading ? (
        <p className="text-xs text-on-surface-variant">{t('loading')}</p>
      ) : items.length === 0 && !showForm ? (
        <p className="rounded-shape-sm border border-dashed border-outline-variant py-3 text-center text-xs text-on-surface-variant">
          {t('noItems')}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) =>
            editingItem?.uuid === item.uuid ? (
              <PricingItemForm
                key={item.uuid}
                initial={itemToForm(item)}
                flightTypes={flightTypes}
                revenueAccounts={revenueAccounts}
                isAssetScoped={true}
                onSave={handleUpdate}
                onCancel={() => setEditingItem(null)}
                saving={updateMutation.isPending}
              />
            ) : (
              <div
                key={item.uuid}
                className="flex items-center gap-3 rounded-shape-sm border border-outline-variant bg-surface px-4 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{item.name}</p>
                  <p className="text-xs text-on-surface-variant">
                    {t(`unit${UNIT_LABELS[item.unit] ?? ''}`)}{' · '}
                    {formatPrice(item.base_price)}
                    {item.tiers.length > 0 && ` · ${item.tiers.map((tier) => `${tier.from_qty}→${formatPrice(tier.price)}`).join(' · ')}`}
                  </p>
                </div>
                {editable && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                      onClick={() => setEditingItem(item)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                      onClick={() => setConfirmDeleteItem(item)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}
      {confirmDeleteItem && (
        <ConfirmDialog
          open={!!confirmDeleteItem}
          title={t('confirmDeleteItemTitle')}
          body={t('confirmDeleteItem')}
          confirmLabel={t('delete')}
          onConfirm={() => { setConfirmDeleteItem(null); handleDelete(confirmDeleteItem) }}
          onCancel={() => setConfirmDeleteItem(null)}
        />
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function AssetFamilyPricingPanel({
  assetFamilyUuid,
}: {
  assetFamilyUuid: string
}) {
  const { t } = useTranslation('pricing')

  const canManagePrices = useCapability('MANAGE_PRICES')
  const canManageAssets = useCapability('MANAGE_ASSETS')
  const canViewFinancials = useCapability('VIEW_FINANCIALS')
  const canView = canManageAssets || canViewFinancials

  const versionsQuery = useAssetPricingVersionsQuery(assetFamilyUuid, canView)
  const versions = (versionsQuery.data ?? []).slice().sort(
    (a, b) => b.from_date.localeCompare(a.from_date),
  )

  const createVersionMutation = useCreateAssetPricingVersionMutation(assetFamilyUuid)
  const updateVersionMutation = useUpdateAssetPricingVersionMutation(assetFamilyUuid)
  const deleteVersionMutation = useDeleteAssetPricingVersionMutation(assetFamilyUuid)
  const cloneVersionMutation = useCloneAssetPricingVersionMutation(assetFamilyUuid)

  const [showNewVersionForm, setShowNewVersionForm] = useState(false)
  const [editingVersion, setEditingVersion] = useState<AssetPricingVersion | null>(null)
  const [expandedVersionUuid, setExpandedVersionUuid] = useState<string | null>(null)
  const [confirmActivateVersion, setConfirmActivateVersion] = useState<AssetPricingVersion | null>(null)
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<AssetPricingVersion | null>(null)
  const [confirmRevertVersion, setConfirmRevertVersion] = useState<AssetPricingVersion | null>(null)
  const [archiveVersion, setArchiveVersion] = useState<AssetPricingVersion | null>(null)
  const [archiveEndDate, setArchiveEndDate] = useState(todayIsoDate())
  const [archiveCreateNext, setArchiveCreateNext] = useState(true)
  const [archiveNextName, setArchiveNextName] = useState('')
  const [archiveNextFromDate, setArchiveNextFromDate] = useState(todayIsoDate())
  const [cloneSourceVersion, setCloneSourceVersion] = useState<AssetPricingVersion | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloneFromDate, setCloneFromDate] = useState(todayIsoDate())
  const [cloneToDate, setCloneToDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreateVersion(form: VersionFormState) {
    try {
      const created = await createVersionMutation.mutateAsync({
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
        use_pack: form.use_pack,
      })
      setShowNewVersionForm(false)
      setExpandedVersionUuid(created.uuid)
      setError(null)
    } catch (e) {
      setError(extractError(e, t('error.saveFailed')))
    }
  }

  async function handleUpdateVersion(form: VersionFormState) {
    if (!editingVersion) return
    try {
      await updateVersionMutation.mutateAsync({
        uuid: editingVersion.uuid,
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
        use_pack: form.use_pack,
      })
      setEditingVersion(null)
      setError(null)
    } catch (e) {
      setError(extractError(e, t('error.saveFailed')))
    }
  }

  async function handleDeleteVersion(v: AssetPricingVersion) {
    try {
      await deleteVersionMutation.mutateAsync(v.uuid)
      if (expandedVersionUuid === v.uuid) setExpandedVersionUuid(null)
      setError(null)
    } catch (e) {
      setError(extractError(e, t('error.deleteFailed')))
    }
  }

  async function handleActivateVersion(v: AssetPricingVersion) {
    try {
      await updateVersionMutation.mutateAsync({ uuid: v.uuid, status: VERSION_STATUS_ACTIVE })
      setError(null)
    } catch (e) {
      setError(extractError(e, t('error.saveFailed')))
    }
  }

  async function handleRevertToDraft(v: AssetPricingVersion) {
    try {
      await updateVersionMutation.mutateAsync({ uuid: v.uuid, status: VERSION_STATUS_DRAFT })
      setError(null)
    } catch (e) {
      setError(extractError(e, t('error.saveFailed')))
    }
  }

  function openCloneDialog(v: AssetPricingVersion) {
    const defaultFromDate = v.to_date ? addDaysIsoDate(v.to_date, 1) : todayIsoDate()
    setCloneSourceVersion(v)
    setCloneName(`${v.name} - ${t('version.new')}`)
    setCloneFromDate(defaultFromDate)
    setCloneToDate('')
  }

  async function handleCloneVersion() {
    if (!cloneSourceVersion) return
    try {
      const cloned = await cloneVersionMutation.mutateAsync({
        source_version_uuid: cloneSourceVersion.uuid,
        name: cloneName,
        from_date: cloneFromDate,
        to_date: cloneToDate || null,
        use_pack: cloneSourceVersion.use_pack,
      })
      setCloneSourceVersion(null)
      setExpandedVersionUuid(cloned.uuid)
      setError(null)
    } catch (e) {
      setError(extractError(e, t('error.saveFailed')))
    }
  }

  function openArchiveDialog(v: AssetPricingVersion) {
    const defaultEndDate = todayIsoDate()
    setArchiveVersion(v)
    setArchiveEndDate(defaultEndDate)
    setArchiveCreateNext(true)
    setArchiveNextName(`${v.name} - ${t('version.new')}`)
    setArchiveNextFromDate(addDaysIsoDate(defaultEndDate, 1))
  }

  async function handleArchiveVersion() {
    if (!archiveVersion) return
    try {
      await updateVersionMutation.mutateAsync({
        uuid: archiveVersion.uuid,
        status: VERSION_STATUS_ARCHIVED,
        to_date: archiveEndDate,
      })
      if (archiveCreateNext) {
        const cloned = await cloneVersionMutation.mutateAsync({
          source_version_uuid: archiveVersion.uuid,
          name: archiveNextName,
          from_date: archiveNextFromDate,
          to_date: null,
          use_pack: archiveVersion.use_pack,
        })
        setExpandedVersionUuid(cloned.uuid)
      }
      setArchiveVersion(null)
      setError(null)
    } catch (e) {
      setError(extractError(e, t('error.saveFailed')))
    }
  }

  if (!canView) {
    return (
      <section className="rounded-shape-lg border border-outline-variant bg-surface p-6">
        <p className="text-sm text-on-surface-variant">{t('noPermission')}</p>
      </section>
    )
  }

  const canEdit = canManagePrices

  return (
    <section className="space-y-4">
      {error && (
        <Alert>
          <p className="text-sm">{error}</p>
        </Alert>
      )}

      <div className="rounded-shape-lg border border-outline-variant bg-surface p-6 shadow-surface-1">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-on-surface-variant">
            {t('version.listTitle')}
          </h2>
          {canEdit && !showNewVersionForm && !editingVersion && (
            <Button className="h-8 rounded-md px-3 text-xs" onClick={() => setShowNewVersionForm(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('version.new')}
            </Button>
          )}
        </div>

        {showNewVersionForm && (
          <div className="mb-4">
            <VersionForm
              initial={{
                name: '',
                from_date: todayIsoDate(),
                to_date: '',
                status: VERSION_STATUS_DRAFT,
                use_pack: true,
              }}
              onSave={handleCreateVersion}
              onCancel={() => setShowNewVersionForm(false)}
              saving={createVersionMutation.isPending}
              t={t}
            />
          </div>
        )}

        {versionsQuery.isLoading ? (
          <p className="text-sm text-on-surface-variant">{t('loading')}</p>
        ) : versions.length === 0 && !showNewVersionForm ? (
          <p className="rounded-shape-md border border-dashed border-outline-variant p-6 text-center text-sm text-on-surface-variant">
            {t('version.empty')}
          </p>
        ) : (
          <div className="space-y-3">
            {versions.map((v) =>
              editingVersion?.uuid === v.uuid ? (
                <VersionForm
                  key={v.uuid}
                  initial={{
                    name: v.name,
                    from_date: v.from_date,
                    to_date: v.to_date ?? '',
                    status: v.status,
                    use_pack: v.use_pack,
                  }}
                  onSave={handleUpdateVersion}
                  onCancel={() => setEditingVersion(null)}
                  saving={updateVersionMutation.isPending}
                  t={t}
                />
              ) : (
                <div
                  key={v.uuid}
                  className="rounded-shape-md border border-outline-variant bg-surface"
                >
                  <div
                    className="flex cursor-pointer items-center gap-3 px-4 py-2.5"
                    onClick={() =>
                      setExpandedVersionUuid((prev) => prev === v.uuid ? null : v.uuid)
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-on-surface">{v.name}</p>
                      <p className="text-xs text-on-surface-variant">
                        {v.from_date} → {v.to_date ?? t('version.openEnd')}
                      </p>
                    </div>
                    <VersionBadge status={v.status} t={t} />
                    {v.is_locked && (
                      <span className="rounded-full bg-error-container px-2 py-0.5 text-xs text-error">
                        {t('version.locked')}
                      </span>
                    )}
                    {canEdit && !v.is_locked && v.status === VERSION_STATUS_DRAFT && (
                      <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-success hover:bg-success-container"
                          onClick={() => setConfirmActivateVersion(v)}
                        >
                          {t('version.activate')}
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                          onClick={() => setEditingVersion(v)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                          onClick={() => setConfirmDeleteVersion(v)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {canEdit && !v.is_locked && v.status === VERSION_STATUS_ACTIVE && (
                      <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                          onClick={() => openCloneDialog(v)}
                        >
                          {t('version.clone')}
                        </button>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-warning hover:bg-warning-container"
                          onClick={() => openArchiveDialog(v)}
                        >
                          {t('version.archive')}
                        </button>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                          onClick={() => setConfirmRevertVersion(v)}
                        >
                          {t('version.revert')}
                        </button>
                      </div>
                    )}
                  </div>

                  {expandedVersionUuid === v.uuid && (
                    <div className="px-4 pb-4">
                      <PricingItemsPanel version={v} canEdit={canEdit && !v.is_locked} t={t} />
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {confirmDeleteVersion && (
        <ConfirmDialog
          open={!!confirmDeleteVersion}
          title={t('version.confirmDeleteTitle')}
          body={t('version.confirmDelete', { name: confirmDeleteVersion.name })}
          confirmLabel={t('delete')}
          onConfirm={() => { const v = confirmDeleteVersion; setConfirmDeleteVersion(null); handleDeleteVersion(v) }}
          onCancel={() => setConfirmDeleteVersion(null)}
        />
      )}
      {confirmActivateVersion && (
        <ConfirmDialog
          open={!!confirmActivateVersion}
          title={t('version.confirmActivateTitle')}
          body={t('version.confirmActivateBody')}
          confirmLabel={t('version.activate')}
          onConfirm={() => {
            const version = confirmActivateVersion
            setConfirmActivateVersion(null)
            handleActivateVersion(version)
          }}
          onCancel={() => setConfirmActivateVersion(null)}
        />
      )}
      {confirmRevertVersion && (
        <ConfirmDialog
          open={!!confirmRevertVersion}
          title={t('version.confirmRevertTitle')}
          body={t('version.confirmRevertBody')}
          confirmLabel={t('version.revert')}
          onConfirm={() => {
            const version = confirmRevertVersion
            setConfirmRevertVersion(null)
            handleRevertToDraft(version)
          }}
          onCancel={() => setConfirmRevertVersion(null)}
        />
      )}

      <Dialog open={!!cloneSourceVersion} onClose={() => setCloneSourceVersion(null)}>
        <DialogContent>
          <div className="space-y-4 p-1">
            <div>
              <h3 className="text-sm font-semibold text-on-surface">{t('version.cloneDialogTitle')}</h3>
              <p className="mt-1 text-xs text-on-surface-variant">{t('version.cloneDialogBody')}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('version.name')}</Label>
              <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">{t('version.fromDate')}</Label>
                <Input type="date" value={cloneFromDate} onChange={(e) => setCloneFromDate(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('version.toDate')}</Label>
                <Input type="date" value={cloneToDate} onChange={(e) => setCloneToDate(e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCloneSourceVersion(null)}>
                {t('version.cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleCloneVersion}
                disabled={cloneVersionMutation.isPending || !cloneName || !cloneFromDate}
              >
                {cloneVersionMutation.isPending ? t('version.saving') : t('version.clone')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!archiveVersion} onClose={() => setArchiveVersion(null)}>
        <DialogContent>
          <div className="space-y-4 p-1">
            <div>
              <h3 className="text-sm font-semibold text-on-surface">{t('version.archiveDialogTitle')}</h3>
              <p className="mt-1 text-xs text-on-surface-variant">{t('version.archiveDialogBody')}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('version.archiveEndDate')}</Label>
              <Input type="date" value={archiveEndDate} onChange={(e) => setArchiveEndDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-xs text-on-surface">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-outline"
                checked={archiveCreateNext}
                onChange={(e) => setArchiveCreateNext(e.target.checked)}
              />
              {t('version.createNext')}
            </label>
            {archiveCreateNext && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">{t('version.nextName')}</Label>
                  <Input value={archiveNextName} onChange={(e) => setArchiveNextName(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('version.nextFromDate')}</Label>
                  <Input
                    type="date"
                    value={archiveNextFromDate}
                    onChange={(e) => setArchiveNextFromDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setArchiveVersion(null)}>
                {t('version.cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleArchiveVersion}
                disabled={
                  updateVersionMutation.isPending ||
                  !archiveEndDate ||
                  (archiveCreateNext && (!archiveNextName || !archiveNextFromDate))
                }
              >
                {(updateVersionMutation.isPending || cloneVersionMutation.isPending)
                  ? t('version.saving')
                  : t('version.confirmArchive')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
