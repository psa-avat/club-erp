/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Assets list screen with filters and status quick actions
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
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AxiosError } from 'axios'
import { Plus, Wrench, Ban, CheckCircle2, Trash2 } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { ImportDialog } from '../../../components/ui/ImportDialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useAssetsQuery,
  useAssetTypesQuery,
  useImportAssetsMutation,
  useTransitionAssetStatusMutation,
} from '../api'
import type { AssetFilters, AssetSummary } from '../types'

// �"?�"? Constants �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

const ASSET_STATUS_OPERATIONAL = 1
const ASSET_STATUS_MAINTENANCE = 2
const ASSET_STATUS_OUT_OF_SERVICE = 3
const ASSET_STATUS_DISPOSED = 4

const ASSET_OWNERSHIP_CLUB = 1
const ASSET_OWNERSHIP_PRIVATE = 2

// �"?�"? Helpers �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

function statusLabel(
  status: number,
  t: (k: string) => string,
): { label: string; className: string } {
  switch (status) {
    case ASSET_STATUS_OPERATIONAL:
      return { label: t('status.operational'), className: 'bg-green-100 text-green-800' }
    case ASSET_STATUS_MAINTENANCE:
      return { label: t('status.maintenance'), className: 'bg-amber-100 text-amber-800' }
    case ASSET_STATUS_OUT_OF_SERVICE:
      return { label: t('status.outOfService'), className: 'bg-red-100 text-red-800' }
    case ASSET_STATUS_DISPOSED:
      return { label: t('status.disposed'), className: 'bg-slate-100 text-slate-500' }
    default:
      return { label: String(status), className: 'bg-slate-100 text-slate-500' }
  }
}

function ownershipLabel(ownership: number, t: (k: string) => string): string {
  return ownership === ASSET_OWNERSHIP_CLUB
    ? t('ownership.club')
    : t('ownership.private')
}

function extractError(e: unknown, fallback: string): string {
  if (e instanceof AxiosError && e.response?.data?.detail) {
    return String(e.response.data.detail)
  }
  return fallback
}

// �"?�"? Status Badge �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

function StatusBadge({ status, t }: { status: number; t: (k: string) => string }) {
  const { label, className } = statusLabel(status, t)
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>
}

// �"?�"? Quick Status Actions �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

function StatusActions({
  asset,
  onTransition,
  t,
}: {
  asset: AssetSummary
  onTransition: (uuid: string, status: number) => void
  t: (k: string) => string
}) {
  if (asset.status === ASSET_STATUS_DISPOSED) return null

  return (
    <div className="flex shrink-0 gap-1">
      {asset.status !== ASSET_STATUS_OPERATIONAL && (
        <button
          type="button"
          title={t('actions.setOperational')}
          onClick={() => onTransition(asset.uuid, ASSET_STATUS_OPERATIONAL)}
          className="rounded p-1 text-slate-400 hover:bg-green-50 hover:text-green-700"
        >
          <CheckCircle2 className="h-4 w-4" />
        </button>
      )}
      {asset.status !== ASSET_STATUS_MAINTENANCE && (
        <button
          type="button"
          title={t('actions.setMaintenance')}
          onClick={() => onTransition(asset.uuid, ASSET_STATUS_MAINTENANCE)}
          className="rounded p-1 text-slate-400 hover:bg-amber-50 hover:text-amber-700"
        >
          <Wrench className="h-4 w-4" />
        </button>
      )}
      {asset.status !== ASSET_STATUS_OUT_OF_SERVICE && (
        <button
          type="button"
          title={t('actions.setOutOfService')}
          onClick={() => onTransition(asset.uuid, ASSET_STATUS_OUT_OF_SERVICE)}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
        >
          <Ban className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        title={t('actions.setDisposed')}
        onClick={() => onTransition(asset.uuid, ASSET_STATUS_DISPOSED)}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

// �"?�"? Main Component �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

export function AssetsListPage() {
  const { t } = useTranslation('assets')
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const canManage = useCapability('MANAGE_ASSETS')
  const canView = useCapability('MANAGE_ASSETS') || useCapability('VIEW_FINANCIALS')

  const [filters, setFilters] = useState<AssetFilters>({ is_active: true })
  const [search, setSearch] = useState('')
  const [transitionError, setTransitionError] = useState<string | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)

  const typesQuery = useAssetTypesQuery(canView)
  const assetsQuery = useAssetsQuery(filters, canView)
  const importAssetsMutation = useImportAssetsMutation()

  const assets = assetsQuery.data ?? []
  const types = typesQuery.data ?? []

  // Client-side name search (backend doesn't support text search for assets)
  const filtered = search.trim()
    ? assets.filter(
        (a) =>
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          a.code.toLowerCase().includes(search.toLowerCase()),
      )
    : assets

  // Per-row transition mutation �?" stored as a map of uuid �?' mutation
  // We use a single shared mutation and track pending uuid
  const [pendingUuid, setPendingUuid] = useState<string | null>(null)
  const transitionMutation = useTransitionAssetStatusMutation(pendingUuid ?? '')

  async function handleTransition(uuid: string, status: number) {
    setPendingUuid(uuid)
    try {
      await transitionMutation.mutateAsync({ status })
      setTransitionError(null)
    } catch (e) {
      setTransitionError(extractError(e, t('error.transitionFailed')))
    } finally {
      setPendingUuid(null)
    }
  }

  function setFilter<K extends keyof AssetFilters>(key: K, value: AssetFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t('list.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('list.description')}</p>
          </div>
          {canManage && (
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate('/assets/types')}>
                {t('assetTypes.title')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowImportDialog(true)}>
                {tCommon('import.button')}
              </Button>
              <Button onClick={() => navigate('/assets/new')} size="sm">
                <Plus className="mr-1 h-4 w-4" />
                {t('actions.newAsset')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {/* Text search */}
          <div className="space-y-1">
            <Label className="text-xs">{t('filters.search')}</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('filters.searchPlaceholder')}
              className="h-8 text-sm"
            />
          </div>

          {/* Type filter */}
          <div className="space-y-1">
            <Label className="text-xs">{t('filters.type')}</Label>
            <select
              value={filters.asset_type_uuid ?? ''}
              onChange={(e) => setFilter('asset_type_uuid', e.target.value || undefined)}
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="">{t('filters.allTypes')}</option>
              {types.map((ty) => (
                <option key={ty.uuid} value={ty.uuid}>
                  {ty.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status filter */}
          <div className="space-y-1">
            <Label className="text-xs">{t('filters.status')}</Label>
            <select
              value={filters.status ?? ''}
              onChange={(e) =>
                setFilter('status', e.target.value ? Number(e.target.value) : undefined)
              }
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="">{t('filters.allStatuses')}</option>
              <option value={ASSET_STATUS_OPERATIONAL}>{t('status.operational')}</option>
              <option value={ASSET_STATUS_MAINTENANCE}>{t('status.maintenance')}</option>
              <option value={ASSET_STATUS_OUT_OF_SERVICE}>{t('status.outOfService')}</option>
              <option value={ASSET_STATUS_DISPOSED}>{t('status.disposed')}</option>
            </select>
          </div>

          {/* Ownership filter */}
          <div className="space-y-1">
            <Label className="text-xs">{t('filters.ownership')}</Label>
            <select
              value={filters.ownership ?? ''}
              onChange={(e) =>
                setFilter('ownership', e.target.value ? Number(e.target.value) : undefined)
              }
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="">{t('filters.allOwnership')}</option>
              <option value={ASSET_OWNERSHIP_CLUB}>{t('ownership.club')}</option>
              <option value={ASSET_OWNERSHIP_PRIVATE}>{t('ownership.private')}</option>
            </select>
          </div>
        </div>

        {/* Active toggle */}
        <div className="mt-3 flex items-center gap-2">
          <input
            id="active-filter"
            type="checkbox"
            checked={filters.is_active ?? false}
            onChange={(e) => setFilter('is_active', e.target.checked ? true : undefined)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <Label htmlFor="active-filter" className="cursor-pointer text-xs">
            {t('filters.activeOnly')}
          </Label>
        </div>
      </div>

      {/* Error */}
      {transitionError && (
        <Alert>
          <p className="text-sm">{transitionError}</p>
        </Alert>
      )}

      {/* List */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {assetsQuery.isLoading ? (
          <p className="p-6 text-sm text-slate-500">{t('states.loading')}</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">{t('states.empty')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((asset) => (
              <div
                key={asset.uuid}
                className="flex items-center gap-4 px-4 py-3"
              >
                {/* Name + type */}
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="truncate text-sm font-medium text-slate-900 hover:text-blue-700"
                    onClick={() => navigate(`/assets/${asset.uuid}`)}
                  >
                    {asset.name}
                  </button>
                  <p className="truncate text-xs text-slate-500">
                    {asset.code} · {asset.asset_type_name} ·{' '}
                    {ownershipLabel(asset.ownership, t)}
                  </p>
                </div>

                <StatusBadge status={asset.status} t={t} />

                {canManage && (
                  <StatusActions asset={asset} onTransition={handleTransition} t={t} />
                )}

                {canManage && (
                  <button
                    type="button"
                    className="shrink-0 rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                    onClick={() => navigate(`/assets/${asset.uuid}/edit`)}
                  >
                    {t('actions.edit')}
                  </button>
                )}

                <button
                  type="button"
                  className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                  onClick={() => navigate(`/assets/${asset.uuid}/pricing`)}
                >
                  {t('actions.pricing')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {showImportDialog && (
        <ImportDialog
          title={tCommon('import.button')}
          onUpload={(file) => importAssetsMutation.mutateAsync(file)}
          sampleCsvHref="/docs/assets-sample.csv"
          onClose={() => setShowImportDialog(false)}
        />
      )}
    </section>
  )
}
