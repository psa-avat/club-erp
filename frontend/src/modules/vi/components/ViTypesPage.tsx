/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: VI type catalog administration page
    Copyright (C) 2026  SAFORCADA Patrick
*/

import { useState } from 'react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useAccountsQuery } from '../../banque/api'
import { useCreateViTypeMutation, useUpdateViTypeMutation, useViTypesQuery } from '../api'

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

export function ViTypesPage() {
  const typesQuery = useViTypesQuery()
  const accountsQuery = useAccountsQuery()
  const createTypeMutation = useCreateViTypeMutation()
  const updateTypeMutation = useUpdateViTypeMutation()

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [chargeAccountUuid, setChargeAccountUuid] = useState<string | null>(null)

  const accounts = accountsQuery.data ?? []
  // Filter expense accounts (type 4) for charge accounts; fallback to all accounts
  const expenseAccounts = accounts.filter((a) => a.type === 4 && a.is_posting_allowed)

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await createTypeMutation.mutateAsync({
      code,
      name,
      description: description || undefined,
      is_active: true,
      charge_account_uuid: chargeAccountUuid,
    })
    setCode('')
    setName('')
    setDescription('')
    setChargeAccountUuid(null)
  }

  async function toggleType(uuid: string, isActive: boolean) {
    await updateTypeMutation.mutateAsync({
      typeUuid: uuid,
      payload: { is_active: !isActive },
    })
  }

  async function updateChargeAccount(typeUuid: string, accountUuid: string | null) {
    await updateTypeMutation.mutateAsync({
      typeUuid,
      payload: { charge_account_uuid: accountUuid },
    })
  }

  return (
    <section className="space-y-4">
      <form className="grid gap-4 rounded-xl border border-outline-variant bg-surface p-6 md:grid-cols-4" onSubmit={handleCreate}>
        <div className="space-y-2">
          <Label htmlFor="vi-type-code">Code</Label>
          <Input id="vi-type-code" required value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vi-type-name">Nom</Label>
          <Input id="vi-type-name" required value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vi-type-description">Description</Label>
          <Input id="vi-type-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Compte de charge</Label>
          <SearchableSelect
            options={expenseAccounts.map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))}
            value={chargeAccountUuid ?? undefined}
            onChange={(val) => setChargeAccountUuid(val ?? null)}
            placeholder="Sélectionner un compte"
          />
        </div>
        <div className="md:col-span-4">
          <Button disabled={createTypeMutation.isPending} type="submit">Ajouter</Button>
        </div>
      </form>

      {typesQuery.error ? <Alert>{toErrorMessage(typesQuery.error)}</Alert> : null}
      {createTypeMutation.error ? <Alert>{toErrorMessage(createTypeMutation.error)}</Alert> : null}
      {updateTypeMutation.error ? <Alert>{toErrorMessage(updateTypeMutation.error)}</Alert> : null}

      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Nom</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Compte de charge</th>
              <th className="px-3 py-2 text-left">Actif</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {(typesQuery.data ?? []).map((row) => (
              <tr key={row.uuid}>
                <td className="px-3 py-2">{row.code}</td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2">{row.description ?? '-'}</td>
                <td className="px-3 py-2">
                  <SearchableSelect
                    options={expenseAccounts.map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))}
                    value={row.charge_account_uuid ?? undefined}
                    onChange={(val) => { void updateChargeAccount(row.uuid, val ?? null) }}
                    placeholder="Aucun"
                  />
                </td>
                <td className="px-3 py-2">{row.is_active ? 'Oui' : 'Non'}</td>
                <td className="px-3 py-2">
                  <Button size="sm" variant="secondary" onClick={() => { void toggleType(row.uuid, row.is_active) }}>
                    {row.is_active ? 'Archiver' : 'Réactiver'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
