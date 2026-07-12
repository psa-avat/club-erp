/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - helloasso: VI staging import and promotion page
    Copyright (C) 2026  SAFORCADA Patrick
*/

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { exportRowsToCsv } from '../../../lib/exportCsv'
import { useHelloAssoItemDetailsMutation } from '../api'
import { useDiscardViStagingMutation, useHelloassoViImportMutation, useHelloassoViPreviewMutation, usePromoteViStagingMutation, useViStagingQuery, useViTypesQuery } from '../../vi/api'

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    const detail = response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }
  }
  return 'Unexpected error'
}

function formatAmount(cents: number | null): string {
  if (cents === null || cents === undefined) return '-'
  return (cents / 100).toFixed(2) + ' €'
}

function formatDateOnly(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(date)
}

export function HelloAssoViImportPage() {
  const { t } = useTranslation('helloasso')
  const stagingQuery = useViStagingQuery()
  const typesQuery = useViTypesQuery()
  const previewMutation = useHelloassoViPreviewMutation()
  const importMutation = useHelloassoViImportMutation()
  const promoteMutation = usePromoteViStagingMutation()
  const discardMutation = useDiscardViStagingMutation()
  const itemDetailsMutation = useHelloAssoItemDetailsMutation()

  const [status, setStatus] = useState<'active' | 'done'>('active')
  const [purchasedFromYear, setPurchasedFromYear] = useState(2025)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [searchText, setSearchText] = useState('')
  const [promotionTypeUuid, setPromotionTypeUuid] = useState('')
  const [showPromoted, setShowPromoted] = useState(false)
  const [sortField, setSortField] = useState<'item_id' | 'amount' | 'date' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [detailsItemId, setDetailsItemId] = useState<number | null>(null)
  const [detailsOrganizationSlug, setDetailsOrganizationSlug] = useState<string | null>(null)
  const [detailsData, setDetailsData] = useState<Record<string, unknown> | null>(null)
  const [loadingDetailsItemId, setLoadingDetailsItemId] = useState<number | null>(null)

  const activeTypes = useMemo(() => (typesQuery.data ?? []).filter((item) => item.is_active), [typesQuery.data])

  // Auto-select default "VI" type when types load
  const defaultTypeUuid = useMemo(() => {
    const vi = activeTypes.find((t) => t.code === 'VI')
    return vi?.uuid ?? activeTypes[0]?.uuid ?? ''
  }, [activeTypes])

  // Keep promotionTypeUuid in sync with default
  useEffect(() => {
    if (!promotionTypeUuid && defaultTypeUuid) {
      setPromotionTypeUuid(defaultTypeUuid)
    }
  }, [promotionTypeUuid, defaultTypeUuid])

  const filteredRows = useMemo(() => {
    let rows = stagingQuery.data ?? []
    // Hide promoted (2) and discarded (3) rows unless showPromoted is on
    if (!showPromoted) {
      rows = rows.filter((row) => row.status === 1)
    }
    if (searchText.trim()) {
      const lower = searchText.trim().toLowerCase()
      rows = rows.filter(
        (row) =>
          row.full_name?.toLowerCase().includes(lower) ||
          String(row.item_id).includes(lower) ||
          row.email?.toLowerCase().includes(lower),
      )
    }
    // Sort
    if (sortField) {
      rows = [...rows].sort((a, b) => {
        let cmp = 0
        if (sortField === 'item_id') {
          cmp = a.item_id - b.item_id
        } else if (sortField === 'amount') {
          cmp = (a.amount_cents ?? 0) - (b.amount_cents ?? 0)
        } else if (sortField === 'date') {
          const da = a.purchased_at ? new Date(a.purchased_at).getTime() : 0
          const db = b.purchased_at ? new Date(b.purchased_at).getTime() : 0
          cmp = da - db
        }
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return rows
  }, [stagingQuery.data, searchText, showPromoted, sortField, sortDir])

  const selectedIds = useMemo(
    () => filteredRows.filter((row) => selected[row.uuid]).map((row) => row.uuid),
    [selected, filteredRows],
  )

  function handleSort(field: 'item_id' | 'amount' | 'date') {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function sortArrow(field: 'item_id' | 'amount' | 'date'): string {
    if (sortField !== field) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  async function runPreview() {
    await previewMutation.mutateAsync({ source: 'items', status, campaign_type: 'Event', purchased_from_year: purchasedFromYear })
  }

  async function runImport() {
    await importMutation.mutateAsync({ source: 'items', status, campaign_type: 'Event', purchased_from_year: purchasedFromYear })
    await stagingQuery.refetch()
  }

  async function discardRow(stagingUuid: string) {
    await discardMutation.mutateAsync(stagingUuid)
  }

  async function promoteSelected() {
    await promoteMutation.mutateAsync({
      staging_uuids: selectedIds,
      vi_type_uuid: promotionTypeUuid || undefined,
    })
    setSelected({})
    await stagingQuery.refetch()
  }

  function exportCsv() {
    const headers = [
      t('viImport.table.item'),
      t('viImport.table.event'),
      t('viImport.table.amount'),
      t('viImport.table.name'),
      t('viImport.table.email'),
      t('viImport.table.purchaseDate'),
      t('viImport.table.status'),
    ]
    const rows = filteredRows.map((row) => [
      row.item_id,
      row.form_slug ?? '',
      formatAmount(row.amount_cents),
      row.full_name ?? '',
      row.email ?? '',
      formatDateOnly(row.purchased_at),
      row.status === 2
        ? t('viImport.table.statusPromoted')
        : row.status === 3
          ? t('viImport.table.statusDiscarded')
          : t('viImport.table.statusStaging'),
    ])
    exportRowsToCsv('helloasso-staging.csv', headers, rows)
  }

  async function getItemDetails(itemId: number) {
    setLoadingDetailsItemId(itemId)
    try {
      const response = await itemDetailsMutation.mutateAsync(itemId)
      setDetailsItemId(response.item_id)
      setDetailsOrganizationSlug(response.organization_slug)
      setDetailsData(response.details)
    } finally {
      setLoadingDetailsItemId(null)
    }
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-outline-variant bg-surface p-6 md:grid-cols-5 md:items-end">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">{t('viImport.form.source')}</label>
          <input
            readOnly
            className="h-10 w-full rounded-md border border-slate-300 bg-slate-100 px-3 text-sm text-slate-700"
            value={t('viImport.form.sourceFixed')}
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">{t('viImport.form.status')}</label>
          <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'done')}>
            <option value="active">Active</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">À partir de l'année</label>
          <input
            type="number"
            min={2000}
            max={2100}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={purchasedFromYear}
            onChange={(event) => setPurchasedFromYear(Number(event.target.value))}
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">{t('viImport.form.campaignType')}</label>
          <input
            readOnly
            className="h-10 w-full rounded-md border border-slate-300 bg-slate-100 px-3 text-sm text-slate-700"
            value={t('viImport.form.campaignTypeFixed')}
          />
        </div>
        <Button variant="secondary" onClick={() => { void runPreview() }}>
          {t('viImport.form.preview')}
        </Button>
        <Button onClick={() => { void runImport() }}>
          {t('viImport.form.import')}
        </Button>
      </div>

      {previewMutation.data ? (
        <div className="rounded-xl border border-outline-variant bg-slate-50 p-4 text-sm text-slate-700">
          <p>{t('viImport.preview.fetched')}: {previewMutation.data.fetched_count}</p>
          <p>{t('viImport.preview.new')}: {previewMutation.data.net_new_count}</p>
          <p>{t('viImport.preview.alreadyStaged')}: {previewMutation.data.already_staged_count}</p>
        </div>
      ) : null}

      {importMutation.data ? (
        <div className="rounded-xl border border-outline-variant bg-slate-50 p-4 text-sm text-slate-700">
          <p>{t('viImport.importResult.created')}: {importMutation.data.created_count}</p>
          <p>{t('viImport.importResult.duplicates')}: {importMutation.data.duplicate_count}</p>
          <p>{t('viImport.importResult.totalStaging')}: {importMutation.data.staging_total_count}</p>
        </div>
      ) : null}

      {previewMutation.error ? <Alert>{toErrorMessage(previewMutation.error)}</Alert> : null}
      {importMutation.error ? <Alert>{toErrorMessage(importMutation.error)}</Alert> : null}
      {promoteMutation.error ? <Alert>{toErrorMessage(promoteMutation.error)}</Alert> : null}
      {discardMutation.error ? <Alert>{toErrorMessage(discardMutation.error)}</Alert> : null}
      {itemDetailsMutation.error ? <Alert>{toErrorMessage(itemDetailsMutation.error)}</Alert> : null}
      {stagingQuery.error ? <Alert>{toErrorMessage(stagingQuery.error)}</Alert> : null}

      <div className="rounded-xl border border-outline-variant bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-900">{t('viImport.staging.title')}</h2>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showPromoted}
              onChange={(event) => setShowPromoted(event.target.checked)}
            />
            Afficher tout (promus &amp; ignorés)
          </label>
          <Input
            className="w-64"
            placeholder={t('viImport.staging.searchPlaceholder')}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <select
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={promotionTypeUuid}
            onChange={(event) => setPromotionTypeUuid(event.target.value)}
          >
            <option value="">{t('viImport.staging.typeDefault')}</option>
            {activeTypes.map((t) => (
              <option key={t.uuid} value={t.uuid}>{t.code} - {t.name}</option>
            ))}
          </select>
          <Button disabled={selectedIds.length === 0 || promoteMutation.isPending} onClick={() => { void promoteSelected() }}>
            {t('viImport.staging.promote')} ({selectedIds.length})
          </Button>
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={filteredRows.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            {t('viImport.staging.exportCsv')}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">{t('viImport.table.select')}</th>
                <th className="px-3 py-2 text-left cursor-pointer select-none hover:text-slate-900" onClick={() => handleSort('item_id')}>
                  {t('viImport.table.item')}{sortArrow('item_id')}
                </th>
                <th className="px-3 py-2 text-left">{t('viImport.table.event')}</th>
                <th className="px-3 py-2 text-left cursor-pointer select-none hover:text-slate-900" onClick={() => handleSort('amount')}>
                  {t('viImport.table.amount')}{sortArrow('amount')}
                </th>
                <th className="px-3 py-2 text-left">{t('viImport.table.name')}</th>
                <th className="px-3 py-2 text-left">{t('viImport.table.email')}</th>
                <th className="px-3 py-2 text-left cursor-pointer select-none hover:text-slate-900" onClick={() => handleSort('date')}>
                  {t('viImport.table.purchaseDate')}{sortArrow('date')}
                </th>
                <th className="px-3 py-2 text-left">{t('viImport.table.status')}</th>
                <th className="px-3 py-2 text-left">{t('viImport.table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredRows.map((row) => (
                <tr key={row.uuid}>
                  <td className="px-3 py-2">
                    <input
                      checked={Boolean(selected[row.uuid])}
                      disabled={row.status === 2}
                      type="checkbox"
                      onChange={() => setSelected((current) => ({ ...current, [row.uuid]: !current[row.uuid] }))}
                    />
                  </td>
                  <td className="px-3 py-2">{row.item_id}</td>
                  <td className="px-3 py-2">{row.form_slug ?? '-'}</td>
                  <td className="px-3 py-2">{formatAmount(row.amount_cents)}</td>
                  <td className="px-3 py-2">{row.full_name ?? '-'}</td>
                  <td className="px-3 py-2">{row.email ?? '-'}</td>
                  <td className="px-3 py-2">{formatDateOnly(row.purchased_at)}</td>
                  <td className="px-3 py-2">
                    {row.status === 2
                      ? t('viImport.table.statusPromoted')
                      : row.status === 3
                        ? t('viImport.table.statusDiscarded')
                        : t('viImport.table.statusStaging')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={itemDetailsMutation.isPending}
                        onClick={() => { void getItemDetails(row.item_id) }}
                      >
                        {loadingDetailsItemId === row.item_id ? t('viImport.details.loading') : t('viImport.details.fetch')}
                      </Button>
                      {row.status === 1 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive border-destructive/30"
                          disabled={discardMutation.isPending}
                          title="Ignorer ce bon (traité par l'ancien système)"
                          onClick={() => { void discardRow(row.uuid) }}
                        >
                          Ignorer
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={9}>
                    {searchText ? t('viImport.empty.noResults') : t('viImport.empty.noRows')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {detailsData ? (
        <div className="rounded-xl border border-outline-variant bg-slate-50 p-4 text-sm text-slate-700">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-900">{t('viImport.details.title')}</h3>
            <span>{t('viImport.details.item')}: {detailsItemId ?? '-'}</span>
            <span>{t('viImport.details.organization')}: {detailsOrganizationSlug ?? '-'}</span>
          </div>
          <pre className="max-h-96 overflow-auto rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed">{JSON.stringify(detailsData, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  )
}
