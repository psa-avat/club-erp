/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: VI type catalog administration page
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

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings2, CheckCircle2, AlertCircle, Download } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { exportRowsToCsv } from '../../../lib/exportCsv'
import { useAccountsQuery } from '../../banque/api'
import { useMemberOptionsQuery } from '../../members/api'
import { type ViType, type ViTypeAccountingPatch, useCreateViTypeMutation, useUpdateViTypeMutation, useViTypesQuery } from '../api'

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

function accountOptions(accounts: ReturnType<typeof useAccountsQuery>['data'], prefix: string) {
  return (accounts ?? [])
    .filter((a) => a.is_posting_allowed && a.code.startsWith(prefix))
    .map((a) => ({ value: a.uuid, label: `${a.code} — ${a.name}` }))
}

// ── Accounting settings dialog ─────────────────────────────────────────────

type AccountingState = {
  analytical_cost_account_uuid: string | null
  analytical_reflection_account_uuid: string | null
  client_account_uuid: string | null
  revenue_account_uuid: string | null
  insurance_account_uuid: string | null
  insurance_tiers_uuid: string | null
  insurance_amount: string
  insurance_expense_account_uuid: string | null
  insurance_revenue_account_uuid: string | null
  max_flights: string
}

function fromViType(vt: ViType): AccountingState {
  return {
    analytical_cost_account_uuid: vt.analytical_cost_account_uuid,
    analytical_reflection_account_uuid: vt.analytical_reflection_account_uuid,
    client_account_uuid: vt.client_account_uuid,
    revenue_account_uuid: vt.revenue_account_uuid,
    insurance_account_uuid: vt.insurance_account_uuid,
    insurance_tiers_uuid: vt.insurance_tiers_uuid,
    insurance_amount: vt.insurance_amount != null ? String(vt.insurance_amount) : '',
    insurance_expense_account_uuid: vt.insurance_expense_account_uuid,
    insurance_revenue_account_uuid: vt.insurance_revenue_account_uuid,
    max_flights: String(vt.max_flights ?? 1),
  }
}

function ViTypeAccountingDialog({
  viType,
  open,
  onOpenChange,
}: {
  viType: ViType
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const updateMutation = useUpdateViTypeMutation()
  const accountsQuery = useAccountsQuery()
  // FO- suppliers = member_category 8
  const suppliersQuery = useMemberOptionsQuery({ member_categories: [8] })

  const [state, setState] = useState<AccountingState>(() => fromViType(viType))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      setState(fromViType(viType))
      setSaved(false)
    }
  }, [open, viType])

  const analyticalOpts = accountOptions(accountsQuery.data, '9')
  const tiersOpts = accountOptions(accountsQuery.data, '4')
  const revenueOpts = accountOptions(accountsQuery.data, '7')
  const expenseOpts = accountOptions(accountsQuery.data, '6')

  const supplierOpts = (suppliersQuery.data ?? []).map((m) => ({
    value: m.uuid,
    label: `${m.account_id} — ${m.first_name} ${m.last_name}`.trim(),
  }))

  function set<K extends keyof AccountingState>(key: K, value: AccountingState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    const patch: ViTypeAccountingPatch = {
      analytical_cost_account_uuid: state.analytical_cost_account_uuid,
      analytical_reflection_account_uuid: state.analytical_reflection_account_uuid,
      client_account_uuid: state.client_account_uuid,
      revenue_account_uuid: state.revenue_account_uuid,
      insurance_account_uuid: state.insurance_account_uuid,
      insurance_tiers_uuid: state.insurance_tiers_uuid,
      insurance_amount: state.insurance_amount !== '' ? Number(state.insurance_amount) : null,
      insurance_expense_account_uuid: state.insurance_expense_account_uuid,
      insurance_revenue_account_uuid: state.insurance_revenue_account_uuid,
      max_flights: state.max_flights !== '' ? Number(state.max_flights) : 1,
    }
    await updateMutation.mutateAsync({ typeUuid: viType.uuid, payload: patch })
    setSaved(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            Paramétrage comptable — {viType.name}
            <span className="font-mono text-xs text-muted-foreground">({viType.code})</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Analytical accounts (class 9) — FL billing */}
          <fieldset className="space-y-4">
            <legend className="text-sm font-medium text-foreground border-b border-border pb-1 w-full">
              Comptes analytiques (classe 9) — facturation FL
            </legend>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Compte coût analytique (débit)
                  {viType.analytical_cost_account_code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{viType.analytical_cost_account_code}</span>
                  )}
                </Label>
                <SearchableSelect
                  options={analyticalOpts}
                  value={state.analytical_cost_account_uuid ?? undefined}
                  onChange={(val) => set('analytical_cost_account_uuid', val ?? null)}
                  placeholder="Ex: 921 — Coûts VI"
                />
                <p className="text-xs text-muted-foreground">Débité à la facturation FL du vol (ex: 921)</p>
              </div>
              <div className="space-y-2">
                <Label>
                  Compte reflet analytique (crédit)
                  {viType.analytical_reflection_account_code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{viType.analytical_reflection_account_code}</span>
                  )}
                </Label>
                <SearchableSelect
                  options={analyticalOpts}
                  value={state.analytical_reflection_account_uuid ?? undefined}
                  onChange={(val) => set('analytical_reflection_account_uuid', val ?? null)}
                  placeholder="Ex: 902 — Reflet charges"
                />
                <p className="text-xs text-muted-foreground">Crédité en contrepartie (ex: 902)</p>
              </div>
            </div>
          </fieldset>

          {/* VI management accounts (Steps 1–4) */}
          <fieldset className="space-y-4">
            <legend className="text-sm font-medium text-foreground border-b border-border pb-1 w-full">
              Gestion VI — étapes 1 à 4 (419 → produit)
            </legend>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Compte avances VI (crédit step 1)
                  {viType.client_account_code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{viType.client_account_code}</span>
                  )}
                </Label>
                <SearchableSelect
                  options={tiersOpts}
                  value={state.client_account_uuid ?? undefined}
                  onChange={(val) => set('client_account_uuid', val ?? null)}
                  placeholder="Ex: 419100"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Compte produit vol (crédit step 2a)
                  {viType.revenue_account_code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{viType.revenue_account_code}</span>
                  )}
                </Label>
                <SearchableSelect
                  options={revenueOpts}
                  value={state.revenue_account_uuid ?? undefined}
                  onChange={(val) => set('revenue_account_uuid', val ?? null)}
                  placeholder="Ex: 7067"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Compte produit assurance (crédit step 2a)
                  {viType.insurance_revenue_account_code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{viType.insurance_revenue_account_code}</span>
                  )}
                </Label>
                <SearchableSelect
                  options={revenueOpts}
                  value={state.insurance_revenue_account_uuid ?? undefined}
                  onChange={(val) => set('insurance_revenue_account_uuid', val ?? null)}
                  placeholder="Ex: 7069"
                />
                <p className="text-xs text-muted-foreground">
                  Si renseigné, le crédit produit vol est limité à la part vol — la part assurance est créditée sur ce compte (ex: 7069).
                </p>
              </div>
              <div className="space-y-2">
                <Label>
                  Compte assurance fournisseur (crédit step 2b)
                  {viType.insurance_account_code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{viType.insurance_account_code}</span>
                  )}
                </Label>
                <SearchableSelect
                  options={tiersOpts}
                  value={state.insurance_account_uuid ?? undefined}
                  onChange={(val) => set('insurance_account_uuid', val ?? null)}
                  placeholder="Ex: 401 — Fournisseur FFVP"
                />
              </div>
              <div className="space-y-2">
                <Label>Tiers assurance (FFVP)</Label>
                <SearchableSelect
                  options={supplierOpts}
                  value={state.insurance_tiers_uuid ?? undefined}
                  onChange={(val) => set('insurance_tiers_uuid', val ?? null)}
                  placeholder="Sélectionner un fournisseur FO-…"
                />
                <p className="text-xs text-muted-foreground">Fournisseur de type FO-xxx pour l'assurance VI</p>
              </div>
              <div className="space-y-2">
                <Label>Montant assurance (€ / vol)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={state.insurance_amount}
                  onChange={(e) => set('insurance_amount', e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Compte charge assurance (débit step 2b)
                  {viType.insurance_expense_account_code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{viType.insurance_expense_account_code}</span>
                  )}
                </Label>
                <SearchableSelect
                  options={expenseOpts}
                  value={state.insurance_expense_account_uuid ?? undefined}
                  onChange={(val) => set('insurance_expense_account_uuid', val ?? null)}
                  placeholder="Ex: 616 — Primes d'assurances"
                />
                <p className="text-xs text-muted-foreground">
                  Si renseigné, le débit 419xxx est limité à la part vol — la charge assurance est débitée sur ce compte (D 616 / C 401).
                </p>
              </div>
              <div className="space-y-2">
                <Label>Nombre de vols max / bon</Label>
                <Input
                  type="number"
                  min="1"
                  max="99"
                  step="1"
                  value={state.max_flights}
                  onChange={(e) => set('max_flights', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">VI=2, JD=2, stage=N</p>
              </div>
            </div>
          </fieldset>

          {/* Footer */}
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <Button
              onClick={() => { void handleSave() }}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
            {saved && !updateMutation.isPending && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Enregistré
              </span>
            )}
            {updateMutation.isError && (
              <span className="flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                Erreur lors de la sauvegarde
              </span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export function ViTypesPage() {
  const { t } = useTranslation('vi')
  const typesQuery = useViTypesQuery()
  const createTypeMutation = useCreateViTypeMutation()
  const updateTypeMutation = useUpdateViTypeMutation()

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [accountingDialogType, setAccountingDialogType] = useState<ViType | null>(null)

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await createTypeMutation.mutateAsync({
      code,
      name,
      description: description || undefined,
      is_active: true,
    })
    setCode('')
    setName('')
    setDescription('')
  }

  async function toggleType(uuid: string, isActive: boolean) {
    await updateTypeMutation.mutateAsync({
      typeUuid: uuid,
      payload: { is_active: !isActive },
    })
  }

  function exportCsv() {
    const headers = ['Code', 'Nom', 'Description', 'Actif']
    const rows = (typesQuery.data ?? []).map((row) => [
      row.code,
      row.name,
      row.description ?? '',
      row.is_active ? 'Oui' : 'Non',
    ])
    exportRowsToCsv('types-vi.csv', headers, rows)
  }

  return (
    <section className="space-y-4">
      <form className="grid gap-4 rounded-xl border border-border bg-card p-6 md:grid-cols-3" onSubmit={handleCreate}>
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
        <div className="md:col-span-3">
          <Button disabled={createTypeMutation.isPending} type="submit">Ajouter</Button>
        </div>
      </form>

      {typesQuery.error ? <Alert>{toErrorMessage(typesQuery.error)}</Alert> : null}
      {createTypeMutation.error ? <Alert>{toErrorMessage(createTypeMutation.error)}</Alert> : null}
      {updateTypeMutation.error ? <Alert>{toErrorMessage(updateTypeMutation.error)}</Alert> : null}

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={(typesQuery.data ?? []).length === 0}
        >
          <Download className="h-3.5 w-3.5 mr-1" />
          {t('types.exportCsv')}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Nom</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Actif</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {(typesQuery.data ?? []).map((row) => (
              <tr key={row.uuid}>
                <td className="px-3 py-2 font-mono">{row.code}</td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.description ?? '-'}</td>
                <td className="px-3 py-2">{row.is_active ? 'Oui' : 'Non'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAccountingDialogType(row)}
                    >
                      <Settings2 className="h-3.5 w-3.5 mr-1" />
                      Comptabilité
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => { void toggleType(row.uuid, row.is_active) }}>
                      {row.is_active ? 'Archiver' : 'Réactiver'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {accountingDialogType && (
        <ViTypeAccountingDialog
          viType={accountingDialogType}
          open={accountingDialogType !== null}
          onOpenChange={(open) => { if (!open) setAccountingDialogType(null) }}
        />
      )}
    </section>
  )
}
