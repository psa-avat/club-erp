/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Generic pricing versions management (no fiscal year)
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
import { Plus, Pencil, Trash2 } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { Dialog, DialogContent } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  VERSION_STATUS_DRAFT,
  VERSION_STATUS_ACTIVE,
  VERSION_STATUS_ARCHIVED,
  VersionBadge,
  VersionForm,
  ActivateVersionButton,
  EMPTY_ITEM,
  PricingItemForm,
  buildItemPayload,
  itemToForm,
  todayIsoDate,
  addDaysIsoDate,
  type VersionFormState,
  type ItemFormState,
} from './pricingShared'
import {
  usePricingVersionsQuery,
  useCreatePricingVersionMutation,
  useUpdatePricingVersionMutation,
  useDeletePricingVersionMutation,
  useClonePricingVersionMutation,
  useAccountsQuery,
  type PricingVersion,
} from '../api'
import {
  usePricingItemsQuery,
  useCreatePricingItemMutation,
  useUpdatePricingItemMutation,
  useDeletePricingItemMutation,
  useFlightTypesQuery,
} from '../../assets/api'
import type { PricingItem } from '../../assets/types'

// ── Pricing Items Panel (inline, generic-scoped) ──────────────────────────────

function GenericPricingItemsPanel({
  version,
  canEdit,
}: {
  version: PricingVersion
  canEdit: boolean
}) {
  const { t } = useTranslation('banque')
  const { t: tp } = useTranslation('pricing')
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

  function extractErr(e: unknown): string {
    if (e instanceof AxiosError && e.response?.data?.detail) return String(e.response.data.detail)
    return tp('error.generic')
  }

  async function handleCreate(form: ItemFormState) {
    try {
      await createMutation.mutateAsync(buildItemPayload(form, { isAssetScoped: false }))
      setShowForm(false)
      setItemError(null)
    } catch (e) { setItemError(extractErr(e)) }
  }

  async function handleUpdate(form: ItemFormState) {
    if (!editingItem) return
    try {
      await updateMutation.mutateAsync({
        uuid: editingItem.uuid,
        ...buildItemPayload(form, { isAssetScoped: false }),
      })
      setEditingItem(null)
      setItemError(null)
    } catch (e) { setItemError(extractErr(e)) }
  }

  async function handleDelete(item: PricingItem) {
    try {
      await deleteMutation.mutateAsync(item.uuid)
      setItemError(null)
    } catch (e) { setItemError(extractErr(e)) }
  }

  const editable = canEdit && !version.is_locked && version.status === VERSION_STATUS_DRAFT

  return (
    <div className="mt-4 space-y-3 border-t border-outline-variant pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-on-surface-variant">{tp('items')}</h3>
        {editable && !showForm && !editingItem && (
          <Button
            className="h-8 rounded-md bg-transparent px-3 text-xs text-on-surface hover:bg-surface-container"
            onClick={() => setShowForm(true)}
          >
            <Plus className="mr-1 h-3 w-3" />
            {tp('addItem')}
          </Button>
        )}
      </div>

      {itemError && <p className="text-xs text-error">{itemError}</p>}

      {showForm && (
        <PricingItemForm
          initial={EMPTY_ITEM}
          flightTypes={flightTypes}
          revenueAccounts={revenueAccounts}
          isAssetScoped={false}
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
          saving={createMutation.isPending}
        />
      )}

      {itemsQuery.isLoading ? (
        <p className="text-xs text-on-surface-variant">{t('states.loading')}</p>
      ) : items.length === 0 && !showForm ? (
        <p className="rounded-shape-sm border border-dashed border-outline-variant py-3 text-center text-xs text-on-surface-variant">
          {tp('noItems')}
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
                isAssetScoped={false}
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
                    {item.base_price} €
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
          title={tp('confirmDeleteItemTitle')}
          body={tp('confirmDeleteItem')}
          confirmLabel={t('delete')}
          onConfirm={() => {
            const item = confirmDeleteItem
            setConfirmDeleteItem(null)
            handleDelete(item)
          }}
          onCancel={() => setConfirmDeleteItem(null)}
        />
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function GenericPricingPage() {
  const { t: tp } = useTranslation('pricing')
  const canManagePrices = useCapability('MANAGE_PRICES')
  const canView = useCapability('VIEW_FINANCIALS')

  const versionsQuery = usePricingVersionsQuery(canView)
  // Only generic versions (asset_type_uuid === null) belong on this tab
  const versions = (versionsQuery.data ?? [])
    .filter((v) => v.asset_type_uuid === null)
    .slice()
    .sort((a, b) => b.from_date.localeCompare(a.from_date))

  const createVersionMutation = useCreatePricingVersionMutation()
  const updateVersionMutation = useUpdatePricingVersionMutation()
  const deleteVersionMutation = useDeletePricingVersionMutation()
  const cloneVersionMutation = useClonePricingVersionMutation()

  const [showNewVersionDialog, setShowNewVersionDialog] = useState(false)
  const [editingVersion, setEditingVersion] = useState<PricingVersion | null>(null)
  const [expandedVersionUuid, setExpandedVersionUuid] = useState<string | null>(null)
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<PricingVersion | null>(null)
  const [confirmActivateVersion, setConfirmActivateVersion] = useState<PricingVersion | null>(null)
  const [confirmRevertVersion, setConfirmRevertVersion] = useState<PricingVersion | null>(null)
  const [archiveVersion, setArchiveVersion] = useState<PricingVersion | null>(null)
  const [archiveEndDate, setArchiveEndDate] = useState(todayIsoDate())
  const [archiveCreateNext, setArchiveCreateNext] = useState(true)
  const [archiveNextName, setArchiveNextName] = useState('')
  const [archiveNextFromDate, setArchiveNextFromDate] = useState(todayIsoDate())
  const [cloneSourceVersion, setCloneSourceVersion] = useState<PricingVersion | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloneFromDate, setCloneFromDate] = useState(todayIsoDate())
  const [cloneToDate, setCloneToDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  function extractErr(e: unknown): string {
    if (e instanceof AxiosError && e.response?.data?.detail) return String(e.response.data.detail)
    return tp('error.generic')
  }

  async function handleCreateVersion(form: VersionFormState) {
    try {
      const created = await createVersionMutation.mutateAsync({
        name: form.name,
        from_date: form.from_date,
        to_date: form.to_date || null,
        status: form.status,
      })
      setShowNewVersionDialog(false)
      setExpandedVersionUuid(created.uuid)
      setError(null)
    } catch (e) { setError(extractErr(e)) }
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
      })
      setEditingVersion(null)
      setError(null)
    } catch (e) { setError(extractErr(e)) }
  }

  async function handleDeleteVersion(v: PricingVersion) {
    try {
      await deleteVersionMutation.mutateAsync(v.uuid)
      if (expandedVersionUuid === v.uuid) setExpandedVersionUuid(null)
      setError(null)
    } catch (e) { setError(extractErr(e)) }
  }

  async function handleActivateVersion(v: PricingVersion) {
    try {
      await updateVersionMutation.mutateAsync({ uuid: v.uuid, status: VERSION_STATUS_ACTIVE })
      setError(null)
    } catch (e) { setError(extractErr(e)) }
  }

  async function handleRevertToDraft(v: PricingVersion) {
    try {
      await updateVersionMutation.mutateAsync({ uuid: v.uuid, status: VERSION_STATUS_DRAFT })
      setError(null)
    } catch (e) { setError(extractErr(e)) }
  }

  function openCloneDialog(v: PricingVersion) {
    const defaultFromDate = v.to_date ? addDaysIsoDate(v.to_date, 1) : todayIsoDate()
    setCloneSourceVersion(v)
    setCloneName(`${v.name} - ${tp('version.new')}`)
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
    } catch (e) { setError(extractErr(e)) }
  }

  function openArchiveDialog(v: PricingVersion) {
    const defaultEndDate = todayIsoDate()
    setArchiveVersion(v)
    setArchiveEndDate(defaultEndDate)
    setArchiveCreateNext(true)
    setArchiveNextName(`${v.name} - ${tp('version.new')}`)
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
    } catch (e) { setError(extractErr(e)) }
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-outline-variant bg-white p-6 shadow-sm">
        <p className="text-sm text-on-surface-variant">{tp('noPermission')}</p>
      </section>
    )
  }

  const canEdit = canManagePrices

  return (
    <section className="space-y-4">
      {error && (
        <div className="rounded-lg border border-error bg-error-container px-4 py-2 text-sm text-error">
          {error}
          <button type="button" className="ml-2 opacity-60 hover:opacity-100" onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="rounded-xl border border-outline-variant bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
          <h2 className="text-sm font-semibold text-on-surface-variant">
            {tp('version.listTitle')}
          </h2>
          {canEdit && (
            <Button size="sm" onClick={() => setShowNewVersionDialog(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {tp('version.new')}
            </Button>
          )}
        </div>

        <div className="space-y-0 p-4">
          {versionsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-on-surface-variant">{tp('loading')}</p>
          ) : versions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-outline-variant p-6 text-center text-sm text-on-surface-variant">
              {tp('version.empty')}
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
                    }}
                    onSave={handleUpdateVersion}
                    onCancel={() => setEditingVersion(null)}
                    saving={updateVersionMutation.isPending}
                  />
                ) : (
                  <div key={v.uuid} className="rounded-lg border border-outline-variant bg-white">
                    <div
                      className="flex cursor-pointer items-center gap-3 px-4 py-2.5"
                      onClick={() =>
                        setExpandedVersionUuid((prev) => (prev === v.uuid ? null : v.uuid))
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-on-surface">{v.name}</p>
                        <p className="text-xs text-on-surface-variant">
                          {v.from_date} → {v.to_date ?? tp('version.openEnd')}
                        </p>
                      </div>
                      <VersionBadge status={v.status} />
                      {v.is_locked && (
                        <span className="rounded-full bg-error-container px-2 py-0.5 text-xs text-error">
                          {tp('version.locked')}
                        </span>
                      )}
                      {canEdit && !v.is_locked && v.status === VERSION_STATUS_DRAFT && (
                        <div className="flex shrink-0 items-start gap-1" onClick={(e) => e.stopPropagation()}>
                          <ActivateVersionButton
                            version={v}
                            onActivate={(v) => setConfirmActivateVersion(v)}
                            disabled={updateVersionMutation.isPending}
                          />
                          <button
                            type="button"
                            className="rounded p-1 text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface"
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
                            className="rounded px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface"
                            onClick={() => openCloneDialog(v)}
                          >
                            {tp('version.clone')}
                          </button>
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-xs text-on-warning-container hover:bg-warning-container"
                            onClick={() => openArchiveDialog(v)}
                          >
                            {tp('version.archive')}
                          </button>
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface"
                            onClick={() => setConfirmRevertVersion(v)}
                          >
                            {tp('version.revert')}
                          </button>
                        </div>
                      )}
                    </div>
                    {expandedVersionUuid === v.uuid && (
                      <div className="px-4 pb-4">
                        <GenericPricingItemsPanel version={v} canEdit={canEdit && !v.is_locked} />
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>

      {/* New version dialog */}
      <Dialog open={showNewVersionDialog} onClose={() => setShowNewVersionDialog(false)}>
        <DialogContent>
          <div className="space-y-4 p-1">
            <div>
              <h3 className="text-sm font-semibold text-on-surface">{tp('version.new')}</h3>
              <p className="mt-1 text-xs text-on-surface-variant">{tp('version.genericScope')}</p>
            </div>
            <VersionForm
              initial={{ name: '', from_date: todayIsoDate(), to_date: '', status: VERSION_STATUS_DRAFT }}
              onSave={handleCreateVersion}
              onCancel={() => setShowNewVersionDialog(false)}
              saving={createVersionMutation.isPending}
            />
          </div>
        </DialogContent>
      </Dialog>

      {confirmDeleteVersion && (
        <ConfirmDialog
          open={!!confirmDeleteVersion}
          title={tp('version.confirmDeleteTitle')}
          body={tp('version.confirmDelete', { name: confirmDeleteVersion.name })}
          confirmLabel={tp('version.deleteTitle')}
          onConfirm={() => {
            const v = confirmDeleteVersion
            setConfirmDeleteVersion(null)
            handleDeleteVersion(v)
          }}
          onCancel={() => setConfirmDeleteVersion(null)}
        />
      )}

      {confirmActivateVersion && (
        <ConfirmDialog
          open={!!confirmActivateVersion}
          title={tp('version.confirmActivateTitle')}
          body={tp('version.confirmActivateBody')}
          confirmLabel={tp('version.activate')}
          onConfirm={() => {
            const v = confirmActivateVersion
            setConfirmActivateVersion(null)
            handleActivateVersion(v)
          }}
          onCancel={() => setConfirmActivateVersion(null)}
        />
      )}

      {confirmRevertVersion && (
        <ConfirmDialog
          open={!!confirmRevertVersion}
          title={tp('version.confirmRevertTitle')}
          body={tp('version.confirmRevertBody')}
          confirmLabel={tp('version.revert')}
          onConfirm={() => {
            const v = confirmRevertVersion
            setConfirmRevertVersion(null)
            handleRevertToDraft(v)
          }}
          onCancel={() => setConfirmRevertVersion(null)}
        />
      )}

      {/* Clone dialog */}
      <Dialog open={!!cloneSourceVersion} onClose={() => setCloneSourceVersion(null)}>
        <DialogContent>
          <div className="space-y-4 p-1">
            <div>
              <h3 className="text-sm font-semibold text-on-surface">{tp('version.cloneDialogTitle')}</h3>
              <p className="mt-1 text-xs text-on-surface-variant">{tp('version.cloneDialogBody')}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{tp('version.name')}</Label>
              <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">{tp('version.fromDate')}</Label>
                <Input type="date" value={cloneFromDate} onChange={(e) => setCloneFromDate(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tp('version.toDate')}</Label>
                <Input type="date" value={cloneToDate} onChange={(e) => setCloneToDate(e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCloneSourceVersion(null)}>
                {tp('version.cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleCloneVersion}
                disabled={cloneVersionMutation.isPending || !cloneName || !cloneFromDate}
              >
                {cloneVersionMutation.isPending ? tp('version.saving') : tp('version.clone')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive dialog */}
      <Dialog open={!!archiveVersion} onClose={() => setArchiveVersion(null)}>
        <DialogContent>
          <div className="space-y-4 p-1">
            <div>
              <h3 className="text-sm font-semibold text-on-surface">{tp('version.archiveDialogTitle')}</h3>
              <p className="mt-1 text-xs text-on-surface-variant">{tp('version.archiveDialogBody')}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{tp('version.archiveEndDate')}</Label>
              <Input type="date" value={archiveEndDate} onChange={(e) => setArchiveEndDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-xs text-on-surface">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-outline-variant"
                checked={archiveCreateNext}
                onChange={(e) => setArchiveCreateNext(e.target.checked)}
              />
              {tp('version.createNext')}
            </label>
            {archiveCreateNext && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">{tp('version.nextName')}</Label>
                  <Input value={archiveNextName} onChange={(e) => setArchiveNextName(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{tp('version.nextFromDate')}</Label>
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
                {tp('version.cancel')}
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
                  ? tp('version.saving')
                  : tp('version.archive')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
