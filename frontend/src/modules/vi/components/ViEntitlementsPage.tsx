/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: Entitlements management page
    Copyright (C) 2026  SAFORCADA Patrick
*/

import { useMemo, useState } from 'react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCreateViEntitlementMutation, usePatchViNotesMutation, useViEntitlementsQuery, useViTypesQuery } from '../api'

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
  const typesQuery = useViTypesQuery()
  const entitlementsQuery = useViEntitlementsQuery()
  const createMutation = useCreateViEntitlementMutation()
  const patchNotesMutation = usePatchViNotesMutation()

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

      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Statut</th>
              <th className="px-3 py-2 text-left">Date planifiée</th>
              <th className="px-3 py-2 text-left">Date réalisée</th>
              <th className="px-3 py-2 text-left">Notes</th>
              <th className="px-3 py-2 text-left">Action notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {(entitlementsQuery.data ?? []).map((row) => (
              <ViEntitlementRow key={row.uuid} row={row} onSaveNotes={saveNotes} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ViEntitlementRow({
  row,
  onSaveNotes,
}: {
  row: {
    uuid: string
    code: string
    vi_type_uuid: string
    status: number
    scheduled_date: string | null
    realisation_date: string | null
    notes: string | null
  }
  onSaveNotes: (uuid: string, notes: string) => Promise<void>
}) {
  const [notes, setNotes] = useState(row.notes ?? '')

  const statusLabel = {
    1: 'Chargé',
    2: 'Planifié',
    3: 'Réalisé',
    4: 'Expiré',
    5: 'Annulé',
  }[row.status] ?? String(row.status)

  return (
    <tr>
      <td className="px-3 py-2">{row.code}</td>
      <td className="px-3 py-2">{row.vi_type_uuid.slice(0, 8)}</td>
      <td className="px-3 py-2">{statusLabel}</td>
      <td className="px-3 py-2">{row.scheduled_date ?? '-'}</td>
      <td className="px-3 py-2">{row.realisation_date ?? '-'}</td>
      <td className="px-3 py-2">
        <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
      </td>
      <td className="px-3 py-2">
        <Button size="sm" variant="secondary" onClick={() => { void onSaveNotes(row.uuid, notes) }}>
          Enregistrer
        </Button>
      </td>
    </tr>
  )
}
