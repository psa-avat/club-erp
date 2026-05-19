/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - helloasso: VI staging import and promotion page
    Copyright (C) 2026  SAFORCADA Patrick
*/

import { useMemo, useState } from 'react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { useHelloassoViImportMutation, useHelloassoViPreviewMutation, usePromoteViStagingMutation, useViStagingQuery } from '../../vi/api'

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

export function HelloAssoViImportPage() {
  const stagingQuery = useViStagingQuery()
  const previewMutation = useHelloassoViPreviewMutation()
  const importMutation = useHelloassoViImportMutation()
  const promoteMutation = usePromoteViStagingMutation()

  const [status, setStatus] = useState<'active' | 'done'>('active')
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const selectedIds = useMemo(
    () => (stagingQuery.data ?? []).filter((row) => selected[row.uuid]).map((row) => row.uuid),
    [selected, stagingQuery.data],
  )

  async function runPreview() {
    await previewMutation.mutateAsync({ source: 'items', status, campaign_type: 'Event' })
  }

  async function runImport() {
    await importMutation.mutateAsync({ source: 'items', status, campaign_type: 'Event' })
    await stagingQuery.refetch()
  }

  async function promoteSelected() {
    await promoteMutation.mutateAsync({ staging_uuids: selectedIds })
    setSelected({})
    await stagingQuery.refetch()
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-outline-variant bg-surface p-6">
        <h1 className="text-xl font-semibold text-slate-900">Import HelloAsso vers staging VI</h1>
        <p className="text-sm text-slate-600">Prévisualisez, importez puis promouvez les achats en droits VI.</p>
      </div>

      <div className="grid gap-3 rounded-xl border border-outline-variant bg-surface p-6 md:grid-cols-4 md:items-end">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Source</label>
          <input
            readOnly
            className="h-10 w-full rounded-md border border-slate-300 bg-slate-100 px-3 text-sm text-slate-700"
            value="Items (fixe)"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Statut</label>
          <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'done')}>
            <option value="active">Active</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Type campagne</label>
          <input
            readOnly
            className="h-10 w-full rounded-md border border-slate-300 bg-slate-100 px-3 text-sm text-slate-700"
            value="Event (fixe)"
          />
        </div>
        <Button variant="secondary" onClick={() => { void runPreview() }}>
          Prévisualiser
        </Button>
        <Button onClick={() => { void runImport() }}>
          Importer dans staging
        </Button>
      </div>

      {previewMutation.data ? (
        <div className="rounded-xl border border-outline-variant bg-slate-50 p-4 text-sm text-slate-700">
          <p>Récupérés: {previewMutation.data.fetched_count}</p>
          <p>Nouveaux: {previewMutation.data.net_new_count}</p>
          <p>Déjà présents: {previewMutation.data.already_staged_count}</p>
        </div>
      ) : null}

      {importMutation.data ? (
        <div className="rounded-xl border border-outline-variant bg-slate-50 p-4 text-sm text-slate-700">
          <p>Créés: {importMutation.data.created_count}</p>
          <p>Doublons: {importMutation.data.duplicate_count}</p>
          <p>Total staging: {importMutation.data.staging_total_count}</p>
        </div>
      ) : null}

      {previewMutation.error ? <Alert>{toErrorMessage(previewMutation.error)}</Alert> : null}
      {importMutation.error ? <Alert>{toErrorMessage(importMutation.error)}</Alert> : null}
      {promoteMutation.error ? <Alert>{toErrorMessage(promoteMutation.error)}</Alert> : null}
      {stagingQuery.error ? <Alert>{toErrorMessage(stagingQuery.error)}</Alert> : null}

      <div className="rounded-xl border border-outline-variant bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Staging HelloAsso</h2>
          <Button disabled={selectedIds.length === 0 || promoteMutation.isPending} onClick={() => { void promoteSelected() }}>
            Promouvoir sélection ({selectedIds.length})
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Sel</th>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Payment</th>
                <th className="px-3 py-2 text-left">Événement</th>
                <th className="px-3 py-2 text-left">Nom</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {(stagingQuery.data ?? []).map((row) => (
                <tr key={row.uuid}>
                  <td className="px-3 py-2">
                    <input
                      checked={Boolean(selected[row.uuid])}
                      disabled={row.status === 2}
                      type="checkbox"
                      onChange={() => setSelected((current) => ({ ...current, [row.uuid]: !current[row.uuid] }))}
                    />
                  </td>
                  <td className="px-3 py-2">{row.order_id}</td>
                  <td className="px-3 py-2">{row.item_id}</td>
                  <td className="px-3 py-2">{row.payment_id}</td>
                  <td className="px-3 py-2">{row.form_slug ?? row.campaign_type ?? '-'}</td>
                  <td className="px-3 py-2">{row.full_name ?? '-'}</td>
                  <td className="px-3 py-2">{row.email ?? '-'}</td>
                  <td className="px-3 py-2">{row.status === 2 ? 'Promu' : row.status === 3 ? 'Ignoré' : 'Staging'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
