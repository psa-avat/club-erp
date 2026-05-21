/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: Entitlements management page
    Copyright (C) 2026  SAFORCADA Patrick
*/

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  useCreateViEntitlementMutation,
  usePatchViEntitlementMutation,
  usePatchViNotesMutation,
  useViEntitlementsQuery,
  useViTypesQuery,
} from '../api'

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

export function ViEntitlementsPage() {
  const { t } = useTranslation('helloasso')
  const typesQuery = useViTypesQuery()
  const entitlementsQuery = useViEntitlementsQuery()
  const createMutation = useCreateViEntitlementMutation()
  const patchNotesMutation = usePatchViNotesMutation()
  const patchEntitlementMutation = usePatchViEntitlementMutation()

  const [code, setCode] = useState('')
  const [typeUuid, setTypeUuid] = useState('')
  const [description, setDescription] = useState('')
  const [originType, setOriginType] = useState(4)

  const activeTypes = useMemo(() => (typesQuery.data ?? []).filter((item) => item.is_active), [typesQuery.data])

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await createMutation.mutateAsync({
      code,
      vi_type_uuid: typeUuid,
      description: description || undefined,
      origin_type: originType,
      status: 1,
    })
    setCode('')
    setDescription('')
  }

  async function saveNotes(entitlementUuid: string, notes: string) {
    await patchNotesMutation.mutateAsync({ entitlementUuid, notes: notes || null })
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-outline-variant bg-surface p-6">
        <h1 className="text-xl font-semibold text-slate-900">Droits VI</h1>
        <p className="text-sm text-slate-600">Gestion des droits: création, suivi, et mise à jour des notes opérationnelles.</p>
      </div>

      <form className="grid gap-4 rounded-xl border border-outline-variant bg-surface p-6 md:grid-cols-4" onSubmit={handleCreate}>
        <div className="space-y-2">
          <Label htmlFor="vi-ent-code">Code</Label>
          <Input id="vi-ent-code" required value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vi-ent-type">Type</Label>
          <select
            id="vi-ent-type"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            required
            value={typeUuid}
            onChange={(event) => setTypeUuid(event.target.value)}
          >
            <option value="">Sélectionner</option>
            {activeTypes.map((row) => (
              <option key={row.uuid} value={row.uuid}>{row.code} - {row.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vi-ent-origin">Origine</Label>
          <select
            id="vi-ent-origin"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={originType}
            onChange={(event) => setOriginType(Number(event.target.value))}
          >
            <option value={1}>HelloAsso</option>
            <option value={2}>Club</option>
            <option value={3}>Offert</option>
            <option value={4}>Manuel</option>
            <option value={5}>Partenaire</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vi-ent-desc">Description</Label>
          <Input id="vi-ent-desc" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div className="md:col-span-4">
          <Button disabled={createMutation.isPending} type="submit">Créer le droit</Button>
        </div>
      </form>

      {entitlementsQuery.error ? <Alert>{toErrorMessage(entitlementsQuery.error)}</Alert> : null}
      {createMutation.error ? <Alert>{toErrorMessage(createMutation.error)}</Alert> : null}
      {patchNotesMutation.error ? <Alert>{toErrorMessage(patchNotesMutation.error)}</Alert> : null}
      {patchEntitlementMutation.error ? <Alert>{toErrorMessage(patchEntitlementMutation.error)}</Alert> : null}

      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.code')}</th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.type')}</th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.description')}</th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.status')}</th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.scheduledDate')}</th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.realisationDate')}</th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.validityDate')}</th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.notes')}</th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {(entitlementsQuery.data ?? []).map((row) => (
              <ViEntitlementRow
                key={row.uuid}
                row={row}
                activeTypes={activeTypes}
                saving={patchEntitlementMutation.isPending}
                onSave={(uuid, payload) => patchEntitlementMutation.mutateAsync({ entitlementUuid: uuid, payload })}
                onSaveNotes={saveNotes}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ViEntitlementRow({
  row,
  activeTypes,
  saving,
  onSave,
  onSaveNotes,
}: {
  row: {
    uuid: string
    code: string
    vi_type_uuid: string
    vi_type_code: string | null
    description: string | null
    status: number
    scheduled_date: string | null
    realisation_date: string | null
    validity_date: string | null
    notes: string | null
  }
  activeTypes: { uuid: string; code: string; name: string }[]
  saving: boolean
  onSave: (uuid: string, payload: Record<string, unknown>) => Promise<unknown>
  onSaveNotes: (uuid: string, notes: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState(row.code)
  const [typeUuid, setTypeUuid] = useState(row.vi_type_uuid)
  const [description, setDescription] = useState(row.description ?? '')
  const [status, setStatus] = useState(row.status)
  const [scheduledDate, setScheduledDate] = useState(row.scheduled_date ?? '')
  const [realisationDate, setRealisationDate] = useState(row.realisation_date ?? '')
  const [validityDate, setValidityDate] = useState(row.validity_date ?? '')
  const [notes, setNotes] = useState(row.notes ?? '')

  function resetFields() {
    setCode(row.code)
    setTypeUuid(row.vi_type_uuid)
    setDescription(row.description ?? '')
    setStatus(row.status)
    setScheduledDate(row.scheduled_date ?? '')
    setRealisationDate(row.realisation_date ?? '')
    setValidityDate(row.validity_date ?? '')
    setNotes(row.notes ?? '')
  }

  async function handleSave() {
    const payload: Record<string, unknown> = {}
    if (code !== row.code) payload.code = code
    if (typeUuid !== row.vi_type_uuid) payload.vi_type_uuid = typeUuid
    if (description !== (row.description ?? '')) payload.description = description || null
    if (status !== row.status) payload.status = status
    if (scheduledDate !== (row.scheduled_date ?? '')) payload.scheduled_date = scheduledDate || null
    if (realisationDate !== (row.realisation_date ?? '')) payload.realisation_date = realisationDate || null
    if (validityDate !== (row.validity_date ?? '')) payload.validity_date = validityDate || null
    if (notes !== (row.notes ?? '')) payload.notes = notes || null

    if (Object.keys(payload).length === 0) {
      setEditing(false)
      return
    }

    await onSave(row.uuid, payload)
    setEditing(false)
  }

  function handleCancel() {
    resetFields()
    setEditing(false)
  }

  const statusLabel: Record<number, string> = {
    1: 'Chargé',
    2: 'Planifié',
    3: 'Réalisé',
    4: 'Expiré',
    5: 'Annulé',
  }

  if (editing) {
    return (
      <tr className="bg-amber-50">
        <td className="px-2 py-1">
          <Input value={code} onChange={(event) => setCode(event.target.value)} />
        </td>
        <td className="px-2 py-1">
          <select
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
            value={typeUuid}
            onChange={(event) => setTypeUuid(event.target.value)}
          >
            {activeTypes.map((t) => (
              <option key={t.uuid} value={t.uuid}>{t.code}</option>
            ))}
          </select>
        </td>
        <td className="px-2 py-1">
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </td>
        <td className="px-2 py-1">
          <select
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
            value={status}
            onChange={(event) => setStatus(Number(event.target.value))}
          >
            {Object.entries(statusLabel).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </td>
        <td className="px-2 py-1">
          <Input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
        </td>
        <td className="px-2 py-1">
          <Input type="date" value={realisationDate} onChange={(event) => setRealisationDate(event.target.value)} />
        </td>
        <td className="px-2 py-1">
          <Input type="date" value={validityDate} onChange={(event) => setValidityDate(event.target.value)} />
        </td>
        <td className="px-2 py-1">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </td>
        <td className="px-2 py-1">
          <div className="flex gap-1">
            <Button size="sm" disabled={saving} onClick={() => { void handleSave() }}>💾</Button>
            <Button size="sm" variant="secondary" onClick={handleCancel}>✕</Button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td className="px-3 py-2">{row.code}</td>
      <td className="px-3 py-2">{row.vi_type_code ?? row.vi_type_uuid.slice(0, 8)}</td>
      <td className="px-3 py-2">{row.description ?? '-'}</td>
      <td className="px-3 py-2">{statusLabel[row.status] ?? String(row.status)}</td>
      <td className="px-3 py-2">{row.scheduled_date ?? '-'}</td>
      <td className="px-3 py-2">{row.realisation_date ?? '-'}</td>
      <td className="px-3 py-2">{row.validity_date ?? '-'}</td>
      <td className="px-3 py-2">
        <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => { void onSaveNotes(row.uuid, notes) }}>
            Notes
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { resetFields(); setEditing(true) }}>
            ✎
          </Button>
        </div>
      </td>
    </tr>
  )
}
