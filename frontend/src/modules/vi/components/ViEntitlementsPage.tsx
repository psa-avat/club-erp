/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - vi: Entitlements management page
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

import { useMemo, useState } from 'react'
import Decimal from 'decimal.js'
import { useTranslation } from 'react-i18next'
import { BookOpen, Pencil, Plus, UserCheck, XCircle } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../../../components/ui/sheet'
import { useActiveFiscalYearQuery, useAccountsQuery, useFiscalYearsQuery } from '../../banque/api'
import { useMemberOptionsQuery } from '../../members/api'
import { ViEntitlementSheet } from './ViFinancePage'
import {
  type ViEntitlement,
  useCreateViConversionEntryMutation,
  useCreateViEntitlementMutation,
  useCreateViPurchaseEntryMutation,
  useCreateViReimbursementEntryMutation,
  usePatchViEntitlementMutation,
  useViEntitlementsQuery,
  useViTypesQuery,
} from '../api'

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    const detail = response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
  }
  return 'Erreur inattendue'
}

function fmtAmount(v: string | null | undefined): string {
  if (v == null) return '—'
  try { return new Decimal(v).toFixed(2) + ' €' } catch { return v }
}

const ORIGIN_LABELS: Record<number, string> = {
  1: 'HelloAsso', 2: 'Club', 3: 'Offert', 4: 'Manuel', 5: 'Partenaire',
}

const STATUS_LABELS: Record<number, string> = {
  1: 'Chargé', 2: 'Planifié', 3: 'Réalisé', 4: 'Expiré', 5: 'Annulé', 6: 'Converti',
}

// ── Cancel dialog ──────────────────────────────────────────────────────────

function CancelDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ViEntitlement
}) {
  const patchMutation = usePatchViEntitlementMutation()
  const reimburseMutation = useCreateViReimbursementEntryMutation()
  const fyQuery = useFiscalYearsQuery()
  const activeFyQuery = useActiveFiscalYearQuery()
  const accountsQuery = useAccountsQuery(true)

  const [step, setStep] = useState<'choice' | 'confirm-plain' | 'reimburse'>('choice')
  const [reimburseNotes, setReimburseNotes] = useState('')
  const [reimburseFyUuid, setReimburseFyUuid] = useState('')
  const [reimburseBankUuid, setReimburseBankUuid] = useState('')
  const [reimburseAmount, setReimburseAmount] = useState(
    row.amount_ttc != null ? new Decimal(row.amount_ttc).toFixed(2) : '',
  )

  const activeFyUuid = activeFyQuery.data?.uuid ?? ''
  const fiscalYears = (fyQuery.data ?? []).filter((fy) => fy.state !== 2)
  const bankAccounts = (accountsQuery.data ?? []).filter((a) => a.code.startsWith('5'))

  const isPending = patchMutation.isPending || reimburseMutation.isPending
  const mutationError = patchMutation.error ?? reimburseMutation.error

  function handleClose() {
    setStep('choice')
    setReimburseNotes('')
    setReimburseFyUuid('')
    setReimburseBankUuid('')
    setReimburseAmount(row.amount_ttc != null ? new Decimal(row.amount_ttc).toFixed(2) : '')
    onOpenChange(false)
  }

  async function handleCancelPlain() {
    await patchMutation.mutateAsync({ entitlementUuid: row.uuid, payload: { status: 5 } })
    handleClose()
  }

  async function handleReimburse() {
    const fyUuid = reimburseFyUuid || activeFyUuid
    if (!fyUuid || !reimburseBankUuid) return
    let amountStr: string | null = null
    if (reimburseAmount.trim()) {
      try {
        const d = new Decimal(reimburseAmount)
        if (d.gt(0)) amountStr = d.toFixed(4)
      } catch { /* leave null, backend uses entitlement.amount_ttc */ }
    }
    await reimburseMutation.mutateAsync({
      entitlementUuid: row.uuid,
      fiscalYearUuid: fyUuid,
      bankAccountUuid: reimburseBankUuid,
      amountTtc: amountStr,
      notes: reimburseNotes.trim() || null,
    })
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Annuler le bon <span className="font-mono">{row.code}</span></DialogTitle>
        </DialogHeader>

        {mutationError && <Alert className="text-sm">{toErrorMessage(mutationError)}</Alert>}

        {step === 'choice' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Choisissez le mode d'annulation. Cette action est irréversible.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/5 justify-start"
                disabled={isPending}
                onClick={() => setStep('confirm-plain')}
              >
                Annuler sans remboursement
              </Button>
              <Button
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/5 justify-start"
                disabled={isPending}
                onClick={() => setStep('reimburse')}
              >
                Annuler avec remboursement
              </Button>
            </div>
          </div>
        )}

        {step === 'confirm-plain' && (
          <div className="space-y-4">
            <p className="text-sm">
              Le bon <span className="font-mono font-medium">{row.code}</span> sera marqué{' '}
              <strong>Annulé</strong> sans écriture comptable.
            </p>
            <DialogFooter className="gap-2">
              <Button variant="ghost" disabled={isPending} onClick={() => setStep('choice')}>Retour</Button>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => { void handleCancelPlain() }}
              >
                Confirmer l'annulation
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'reimburse' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Crée une écriture brouillon VI : D Compte avances (419) / C Banque (512). Le bon sera annulé.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Exercice fiscal</Label>
                <select
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={reimburseFyUuid || activeFyUuid}
                  onChange={(e) => setReimburseFyUuid(e.target.value)}
                >
                  {fiscalYears.map((fy) => (
                    <option key={fy.uuid} value={fy.uuid}>{fy.code}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Montant (€)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={reimburseAmount}
                  onChange={(e) => setReimburseAmount(e.target.value)}
                  placeholder="Laisser vide = montant du bon"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Compte bancaire (5xx) <span className="text-destructive">*</span></Label>
              <select
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                value={reimburseBankUuid}
                onChange={(e) => setReimburseBankUuid(e.target.value)}
              >
                <option value="">Sélectionner…</option>
                {bankAccounts.map((a) => (
                  <option key={a.uuid} value={a.uuid}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Libellé (optionnel)</Label>
              <Input
                placeholder={`Remboursement bon VI ${row.code}`}
                value={reimburseNotes}
                onChange={(e) => setReimburseNotes(e.target.value)}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" disabled={isPending} onClick={() => setStep('choice')}>Retour</Button>
              <Button
                variant="destructive"
                disabled={isPending || !reimburseBankUuid || !(reimburseFyUuid || activeFyUuid)}
                onClick={() => { void handleReimburse() }}
              >
                Créer l'écriture et annuler
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Conversion dialog ──────────────────────────────────────────────────────

function ConversionDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ViEntitlement | null
}) {
  const conversionMutation = useCreateViConversionEntryMutation()
  const fyQuery = useFiscalYearsQuery()
  const activeFyQuery = useActiveFiscalYearQuery()

  const [conversionFyUuid, setConversionFyUuid] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [selectedMemberUuid, setSelectedMemberUuid] = useState('')
  const memberOptionsQuery = useMemberOptionsQuery({ search: memberSearch, limit: 20 })

  const activeFyUuid = activeFyQuery.data?.uuid ?? ''
  const fiscalYears = (fyQuery.data ?? []).filter((fy) => fy.state !== 2)

  function handleClose() {
    setConversionFyUuid('')
    setMemberSearch('')
    setSelectedMemberUuid('')
    onOpenChange(false)
  }

  async function handleConvert() {
    if (!row) return
    const fyUuid = conversionFyUuid || activeFyUuid
    if (!fyUuid || !selectedMemberUuid) return
    await conversionMutation.mutateAsync({
      entitlementUuid: row.uuid,
      fiscalYearUuid: fyUuid,
      registeredMemberUuid: selectedMemberUuid,
    })
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Conversion en membre{row ? ` — ${row.code}` : ''}
          </DialogTitle>
        </DialogHeader>

        {conversionMutation.error && (
          <Alert className="text-sm">{toErrorMessage(conversionMutation.error)}</Alert>
        )}

        {row?.conversion_entry_uuid ? (
          <p className="text-sm text-muted-foreground py-2">
            Conversion déjà effectuée — écriture OD créée ({row.conversion_entry_uuid.slice(0, 8)}…).
            {row.registered_member_uuid && ` Membre : ${row.registered_member_uuid.slice(0, 8)}…`}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Crée une écriture OD (D 7067 + D 401 / C 411-membre), annule la facturation VI des vols
              et les refacture au pilote membre.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Exercice fiscal</Label>
              <select
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                value={conversionFyUuid || activeFyUuid}
                onChange={(e) => setConversionFyUuid(e.target.value)}
              >
                {fiscalYears.map((fy) => (
                  <option key={fy.uuid} value={fy.uuid}>{fy.code}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rechercher un membre <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Nom, prénom ou code…"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
              />
            </div>
            {memberSearch.length >= 2 && (
              <div className="space-y-1">
                <Label className="text-xs">Membre</Label>
                <select
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={selectedMemberUuid}
                  onChange={(e) => setSelectedMemberUuid(e.target.value)}
                >
                  <option value="">Sélectionner…</option>
                  {(memberOptionsQuery.data ?? []).map((m) => (
                    <option key={m.uuid} value={m.uuid}>
                      {m.account_id} — {m.first_name} {m.last_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={handleClose}>Fermer</Button>
          {!row?.conversion_entry_uuid && (
            <Button
              disabled={conversionMutation.isPending || !selectedMemberUuid || !(conversionFyUuid || activeFyUuid)}
              onClick={() => { void handleConvert() }}
            >
              Convertir en membre
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Voucher sheet (create + edit) ──────────────────────────────────────────

function VoucherSheet({
  open,
  onOpenChange,
  row,
  activeTypes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ViEntitlement | null  // null = create mode
  activeTypes: { uuid: string; code: string; name: string }[]
}) {
  const isEdit = row !== null
  const createMutation = useCreateViEntitlementMutation()
  const patchMutation = usePatchViEntitlementMutation()
  const purchaseMutation = useCreateViPurchaseEntryMutation()

  const fyQuery = useFiscalYearsQuery()
  const activeFyQuery = useActiveFiscalYearQuery()
  const accountsQuery = useAccountsQuery(true)

  const [code, setCode] = useState(row?.code ?? '')
  const [typeUuid, setTypeUuid] = useState(row?.vi_type_uuid ?? (activeTypes[0]?.uuid ?? ''))
  const [description, setDescription] = useState(row?.description ?? '')
  const [amountInput, setAmountInput] = useState(
    row?.amount_ttc != null ? new Decimal(row.amount_ttc).toFixed(2) : '',
  )
  const [originType, setOriginType] = useState(row?.origin_type ?? 4)
  const [scheduledDate, setScheduledDate] = useState(row?.scheduled_date ?? '')
  const [validityDate, setValidityDate] = useState(row?.validity_date ?? '')
  const [isGeneric, setIsGeneric] = useState(row?.is_generic ?? false)
  const [statusVal, setStatusVal] = useState(row?.status ?? 1)
  const [notes, setNotes] = useState(row?.notes ?? '')

  // purchase entry state (create mode only)
  const [withPurchaseEntry, setWithPurchaseEntry] = useState(false)
  const [purchaseFyUuid, setPurchaseFyUuid] = useState('')
  const [purchaseBankUuid, setPurchaseBankUuid] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [purchaseNotes, setPurchaseNotes] = useState('')

  const activeFyUuid = activeFyQuery.data?.uuid ?? ''
  const fiscalYears = (fyQuery.data ?? []).filter((fy) => fy.state !== 2)
  const bankAccounts = (accountsQuery.data ?? []).filter((a) => a.code.startsWith('5'))

  const isPending = createMutation.isPending || patchMutation.isPending || purchaseMutation.isPending
  const mutationError = createMutation.error ?? patchMutation.error ?? purchaseMutation.error

  function resetToRow() {
    setCode(row?.code ?? '')
    setTypeUuid(row?.vi_type_uuid ?? (activeTypes[0]?.uuid ?? ''))
    setDescription(row?.description ?? '')
    setAmountInput(row?.amount_ttc != null ? new Decimal(row.amount_ttc).toFixed(2) : '')
    setOriginType(row?.origin_type ?? 4)
    setScheduledDate(row?.scheduled_date ?? '')
    setValidityDate(row?.validity_date ?? '')
    setIsGeneric(row?.is_generic ?? false)
    setStatusVal(row?.status ?? 1)
    setNotes(row?.notes ?? '')
    setWithPurchaseEntry(false)
    setPurchaseFyUuid('')
    setPurchaseBankUuid('')
    setPurchaseDate('')
    setPurchaseNotes('')
  }

  function handleOpenChange(v: boolean) {
    if (!v) resetToRow()
    onOpenChange(v)
  }

  function parseAmount(): string | null {
    const trimmed = amountInput.trim()
    if (!trimmed) return null
    try {
      const d = new Decimal(trimmed)
      if (d.lt(0)) return null
      return d.toFixed(4)
    } catch { return null }
  }

  async function handleSave() {
    const amount = parseAmount()
    if (isEdit && row) {
      const payload: Record<string, unknown> = {}
      if (code !== row.code) payload.code = code
      if (typeUuid !== row.vi_type_uuid) payload.vi_type_uuid = typeUuid
      if (description !== (row.description ?? '')) payload.description = description || null
      const rawAmount = row.amount_ttc != null ? new Decimal(row.amount_ttc).toFixed(4) : null
      if (amount !== rawAmount) payload.amount_ttc = amount
      if (originType !== row.origin_type) payload.origin_type = originType
      if (scheduledDate !== (row.scheduled_date ?? '')) payload.scheduled_date = scheduledDate || null
      if (validityDate !== (row.validity_date ?? '')) payload.validity_date = validityDate || null
      if (isGeneric !== row.is_generic) payload.is_generic = isGeneric
      if (statusVal !== row.status) payload.status = statusVal
      if (notes !== (row.notes ?? '')) payload.notes = notes || null
      if (Object.keys(payload).length === 0) { onOpenChange(false); return }
      await patchMutation.mutateAsync({ entitlementUuid: row.uuid, payload })
    } else {
      const created = await createMutation.mutateAsync({
        code,
        vi_type_uuid: typeUuid,
        description: description || undefined,
        amount_ttc: amount ?? undefined,
        origin_type: originType,
        scheduled_date: scheduledDate || null,
        validity_date: validityDate || null,
        is_generic: isGeneric,
        status: statusVal,
        notes: notes || null,
      })
      if (withPurchaseEntry && purchaseBankUuid && (purchaseFyUuid || activeFyUuid)) {
        await purchaseMutation.mutateAsync({
          entitlementUuid: created.uuid,
          fiscalYearUuid: purchaseFyUuid || activeFyUuid,
          bankAccountUuid: purchaseBankUuid,
          entryDate: purchaseDate || null,
          amountTtc: amount,
          notes: purchaseNotes.trim() || null,
        })
      }
    }
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isEdit ? `Bon VI — ${row?.code}` : 'Nouveau bon VI'}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 pt-4">
          {mutationError && (
            <Alert>{toErrorMessage(mutationError)}</Alert>
          )}

          {/* ── Informations ── */}
          <fieldset className="space-y-3 rounded-lg border border-outline-variant p-4">
            <legend className="text-sm font-medium px-1">Informations</legend>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="vs-code">Code <span className="text-destructive">*</span></Label>
                <Input
                  id="vs-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Ex : VI2026-0001"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vs-amount">Montant TTC (€)</Label>
                <Input
                  id="vs-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex : 90.00"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="vs-type">Type VI <span className="text-destructive">*</span></Label>
              <select
                id="vs-type"
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                required
                value={typeUuid}
                onChange={(e) => setTypeUuid(e.target.value)}
              >
                <option value="">Sélectionner un type…</option>
                {activeTypes.map((t) => (
                  <option key={t.uuid} value={t.uuid}>{t.code} — {t.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="vs-desc">Description</Label>
              <Input
                id="vs-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Nom de l'acheteur ou objet…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="vs-origin">Origine</Label>
                <select
                  id="vs-origin"
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={originType}
                  onChange={(e) => setOriginType(Number(e.target.value))}
                >
                  {Object.entries(ORIGIN_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="vs-status">Statut</Label>
                <select
                  id="vs-status"
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={statusVal}
                  onChange={(e) => setStatusVal(Number(e.target.value))}
                >
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          {/* ── Planification ── */}
          <fieldset className="space-y-3 rounded-lg border border-outline-variant p-4">
            <legend className="text-sm font-medium px-1">Planification</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="vs-sched">Date prévue</Label>
                <Input
                  id="vs-sched"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vs-valid">Date validité</Label>
                <Input
                  id="vs-valid"
                  type="date"
                  value={validityDate}
                  onChange={(e) => setValidityDate(e.target.value)}
                />
              </div>
            </div>
          </fieldset>

          {/* ── Options & notes ── */}
          <fieldset className="space-y-3 rounded-lg border border-outline-variant p-4">
            <legend className="text-sm font-medium px-1">Options</legend>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={isGeneric}
                onChange={(e) => setIsGeneric(e.target.checked)}
              />
              Bon générique (catch-all, pas d'écriture individuelle)
            </label>
            <div className="space-y-1">
              <Label htmlFor="vs-notes">Notes</Label>
              <textarea
                id="vs-notes"
                rows={3}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm resize-none"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </fieldset>

          {/* ── Encaissement (create mode only) ── */}
          {!isEdit && (
            <fieldset className="space-y-3 rounded-lg border border-outline-variant p-4">
              <legend className="text-sm font-medium px-1">Encaissement</legend>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={withPurchaseEntry}
                  onChange={(e) => setWithPurchaseEntry(e.target.checked)}
                />
                Créer une écriture de paiement reçu (D Banque/Caisse / C 419)
              </label>
              {withPurchaseEntry && (
                <div className="space-y-3 pt-1">
                  <p className="text-xs text-muted-foreground">
                    Écriture brouillon dans le journal VI. Le montant du bon est utilisé.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Exercice fiscal</Label>
                      <select
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                        value={purchaseFyUuid || activeFyUuid}
                        onChange={(e) => setPurchaseFyUuid(e.target.value)}
                      >
                        {fiscalYears.map((fy) => (
                          <option key={fy.uuid} value={fy.uuid}>{fy.code}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Date de l'écriture</Label>
                      <Input
                        type="date"
                        value={purchaseDate}
                        onChange={(e) => setPurchaseDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Compte banque/caisse (5xx) <span className="text-destructive">*</span></Label>
                    <select
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                      value={purchaseBankUuid}
                      onChange={(e) => setPurchaseBankUuid(e.target.value)}
                    >
                      <option value="">Sélectionner…</option>
                      {bankAccounts.map((a) => (
                        <option key={a.uuid} value={a.uuid}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Libellé (optionnel)</Label>
                    <Input
                      placeholder={`Encaissement bon VI ${code}`}
                      value={purchaseNotes}
                      onChange={(e) => setPurchaseNotes(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </fieldset>
          )}

          {/* ── Save ── */}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => handleOpenChange(false)}>
              Fermer
            </Button>
            <Button
              disabled={isPending || !code || !typeUuid || (withPurchaseEntry && !purchaseBankUuid)}
              onClick={() => { void handleSave() }}
            >
              {isEdit ? 'Enregistrer' : 'Créer le bon'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export function ViEntitlementsPage() {
  const { t } = useTranslation('helloasso')
  const typesQuery = useViTypesQuery()
  const entitlementsQuery = useViEntitlementsQuery()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editRow, setEditRow] = useState<ViEntitlement | null>(null)
  const [cancelRow, setCancelRow] = useState<ViEntitlement | null>(null)
  const [conversionRow, setConversionRow] = useState<ViEntitlement | null>(null)
  const [accountingRow, setAccountingRow] = useState<ViEntitlement | null>(null)

  // Filter state
  const [filterCode, setFilterCode] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterDescription, setFilterDescription] = useState('')
  const [statusFilter, setStatusFilterVal] = useState<string>('active')

  // Sort state
  const [sortField, setSortField] = useState<'code' | 'type' | 'validity' | 'status' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const activeTypes = useMemo(() => (typesQuery.data ?? []).filter((item) => item.is_active), [typesQuery.data])

  function openCreate() {
    setEditRow(null)
    setSheetOpen(true)
  }

  function openEdit(row: ViEntitlement) {
    setEditRow(row)
    setSheetOpen(true)
  }

  function handleSort(field: 'code' | 'type' | 'validity' | 'status') {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function sortArrow(field: 'code' | 'type' | 'validity' | 'status'): string {
    if (sortField !== field) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  const filteredAndSortedRows = useMemo(() => {
    let rows = entitlementsQuery.data ?? []

    if (statusFilter === 'active') {
      rows = rows.filter((row) => row.status <= 2)
    } else if (statusFilter !== 'all') {
      const n = Number(statusFilter)
      rows = rows.filter((row) => row.status === n)
    }

    const codeLower = filterCode.trim().toLowerCase()
    const typeLower = filterType.trim().toLowerCase()
    const descLower = filterDescription.trim().toLowerCase()

    if (codeLower) rows = rows.filter((row) => row.code.toLowerCase().includes(codeLower))
    if (typeLower) rows = rows.filter((row) => (row.vi_type_code ?? '').toLowerCase().includes(typeLower))
    if (descLower) rows = rows.filter((row) => (row.description ?? '').toLowerCase().includes(descLower))

    if (sortField) {
      rows = [...rows].sort((a, b) => {
        let cmp = 0
        if (sortField === 'code') cmp = a.code.localeCompare(b.code)
        else if (sortField === 'type') cmp = (a.vi_type_code ?? '').localeCompare(b.vi_type_code ?? '')
        else if (sortField === 'validity') {
          const da = a.validity_date ? new Date(a.validity_date).getTime() : 0
          const db = b.validity_date ? new Date(b.validity_date).getTime() : 0
          cmp = da - db
        } else if (sortField === 'status') cmp = a.status - b.status
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return rows
  }, [entitlementsQuery.data, filterCode, filterType, filterDescription, statusFilter, sortField, sortDir])

  const statusBadgeClass = (status: number) =>
    status === 1 ? 'badge badge-info' :
    status === 2 ? 'badge badge-warning' :
    status === 3 ? 'badge badge-success' :
    status === 4 ? 'badge badge-destructive' :
    status === 5 ? 'badge badge-destructive' :
    status === 6 ? 'badge badge-success' :
    'badge'

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Bons VI</h2>
          <p className="text-sm text-muted-foreground">Créez et gérez les droits de vol initiation.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Nouveau bon
        </Button>
      </div>

      {entitlementsQuery.error && (
        <Alert>{toErrorMessage(entitlementsQuery.error)}</Alert>
      )}

      {/* Filters */}
      <div className="grid gap-3 rounded-xl border border-outline-variant bg-surface p-4 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="vi-filter-code" className="text-xs">{t('viEntitlements.filters.code')}</Label>
          <Input
            id="vi-filter-code"
            placeholder={t('viEntitlements.filters.codePlaceholder')}
            value={filterCode}
            onChange={(e) => setFilterCode(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="vi-filter-type" className="text-xs">{t('viEntitlements.filters.type')}</Label>
          <Input
            id="vi-filter-type"
            placeholder={t('viEntitlements.filters.typePlaceholder')}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="vi-filter-desc" className="text-xs">{t('viEntitlements.filters.description')}</Label>
          <Input
            id="vi-filter-desc"
            placeholder={t('viEntitlements.filters.descriptionPlaceholder')}
            value={filterDescription}
            onChange={(e) => setFilterDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="vi-filter-status" className="text-xs">Statut</Label>
          <select
            id="vi-filter-status"
            value={statusFilter}
            onChange={(e) => setStatusFilterVal(e.target.value)}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="active">Actifs (Chargé + Planifié)</option>
            <option value="all">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left cursor-pointer select-none hover:text-slate-900" onClick={() => handleSort('code')}>
                {t('viEntitlements.table.code')}{sortArrow('code')}
              </th>
              <th className="px-3 py-2 text-left cursor-pointer select-none hover:text-slate-900" onClick={() => handleSort('type')}>
                {t('viEntitlements.table.type')}{sortArrow('type')}
              </th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.description')}</th>
              <th className="px-3 py-2 text-right">Montant TTC</th>
              <th className="px-3 py-2 text-left">Gén.</th>
              <th className="px-3 py-2 text-left cursor-pointer select-none hover:text-slate-900" onClick={() => handleSort('status')}>
                {t('viEntitlements.table.status')}{sortArrow('status')}
              </th>
              <th className="px-3 py-2 text-left cursor-pointer select-none hover:text-slate-900" onClick={() => handleSort('validity')}>
                {t('viEntitlements.table.validityDate')}{sortArrow('validity')}
              </th>
              <th className="px-3 py-2 text-left">{t('viEntitlements.table.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filteredAndSortedRows.map((row) => {
              const isMuted = row.status === 5 || row.status === 6
              return (
                <tr key={row.uuid} className={isMuted ? 'opacity-50' : undefined}>
                  <td className="px-3 py-2 font-mono">{row.code}</td>
                  <td className="px-3 py-2">
                    {row.vi_type_code
                      ? <Badge variant="outline" className="font-mono">{row.vi_type_code}</Badge>
                      : <span className="text-muted-foreground text-xs">{row.vi_type_uuid.slice(0, 8)}</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{row.description ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtAmount(row.amount_ttc)}</td>
                  <td className="px-3 py-2">
                    {row.is_generic ? <span className="badge badge-info text-xs">Gén.</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className={statusBadgeClass(row.status)}>
                      {STATUS_LABELS[row.status] ?? String(row.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.validity_date ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-0.5">
                      {/* Edit — status 1 (Chargé) and 2 (Planifié) only */}
                      {(row.status === 1 || row.status === 2) && (
                        <button
                          onClick={() => openEdit(row)}
                          className="rounded p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                          title="Éditer"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {/* Cancel — status 1 (Chargé) only */}
                      {row.status === 1 && (
                        <button
                          onClick={() => setCancelRow(row)}
                          className="rounded p-1.5 text-slate-300 hover:text-destructive transition-colors"
                          title="Annuler le bon"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                      {/* Member conversion — status 3 (Réalisé) only, not yet converted */}
                      {row.status === 3 && !row.conversion_entry_uuid && (
                        <button
                          onClick={() => setConversionRow(row)}
                          className="rounded p-1.5 text-slate-300 hover:text-blue-600 transition-colors"
                          title="Conversion en membre"
                        >
                          <UserCheck className="h-4 w-4" />
                        </button>
                      )}
                      {/* Accounting sheet — non-generic vouchers only */}
                      {!row.is_generic && (
                        <button
                          onClick={() => setAccountingRow(row)}
                          className="rounded p-1.5 text-slate-300 hover:text-slate-700 transition-colors"
                          title="Comptabilité VI"
                        >
                          <BookOpen className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {filteredAndSortedRows.length === 0 && !entitlementsQuery.isLoading && (
              <tr>
                <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                  Aucun droit trouvé{statusFilter === 'active' ? ' (réalisés, annulés et convertis masqués)' : ''}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <VoucherSheet
        key={editRow?.uuid ?? 'new'}
        open={sheetOpen}
        onOpenChange={(v) => {
          setSheetOpen(v)
          if (!v) setEditRow(null)
        }}
        row={editRow}
        activeTypes={activeTypes}
      />

      {accountingRow && (
        <ViEntitlementSheet
          key={accountingRow.uuid}
          entitlement={accountingRow}
          open={true}
          onOpenChange={(open) => { if (!open) setAccountingRow(null) }}
        />
      )}

      {cancelRow && (
        <CancelDialog
          key={cancelRow.uuid}
          open={true}
          onOpenChange={(open) => { if (!open) setCancelRow(null) }}
          row={cancelRow}
        />
      )}

      <ConversionDialog
        key={conversionRow?.uuid ?? 'none'}
        open={conversionRow !== null}
        onOpenChange={(open) => { if (!open) setConversionRow(null) }}
        row={conversionRow}
      />
    </section>
  )
}
