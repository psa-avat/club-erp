/*
    ERP-CLUB - ERP pour Club de vol à voile
    - banque: OpsPacksTab — pack purchases listing and management
    Copyright (C) 2026  SAFORCADA Patrick
    ...
*/
import { useState, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Plus, Loader2, RefreshCw, RotateCcw, CheckCircle2, AlertTriangle, X, Pencil, Download } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Checkbox } from '../../../components/ui/checkbox'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { useCapability } from '../../../auth/hooks/useCapability'
import { usePackPurchasesQuery, useDiscountReviewMutation, useMemberDiscountReviewMutation } from '../api'
import { PackPurchaseDialog } from './PackPurchaseDialog'
import { PackEditDialog } from './PackEditDialog'
import { exportTableToPdf } from '../../../lib/exportPdf'
import type { DiscountReviewResult, PackPurchaseLine } from '../api'

const PAGE_SIZE = 50

export function OpsPacksTab() {
  const { t } = useTranslation(['banque', 'common'])
  const canManagePrices = useCapability('MANAGE_PRICES')
  const canPostEntries = useCapability('POST_ACCOUNTING_ENTRIES')
  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  const [filterPilot, setFilterPilot] = useState('')
  const [page, setPage] = useState(1)
  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [forceFullRecalc, setForceFullRecalc] = useState(false)
  const [reviewResult, setReviewResult] = useState<DiscountReviewResult | null>(null)
  const [memberRecalcState, setMemberRecalcState] = useState<Record<string, { status: 'idle' | 'running' | 'done'; result?: DiscountReviewResult }>>({})
  const [editDialog, setEditDialog] = useState<{ entryUuid: string; validFrom: string } | null>(null)

  const { data: purchases, isLoading } = usePackPurchasesQuery(
    activeFiscalYearUuid,
    undefined,
    !!activeFiscalYearUuid,
    filterPilot || undefined,
    page,
    PAGE_SIZE,
  )

  const discountReviewMutation = useDiscountReviewMutation()
  const memberDiscountReviewMutation = useMemberDiscountReviewMutation()

  function formatEur(value: string | number | null | undefined): string {
    if (!value) return '—'
    const n = Number(value)
    return Number.isFinite(n) ? `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} EUR` : '—'
  }

  async function handleDiscountReview() {
    if (!activeFiscalYearUuid) return
    setShowConfirmDialog(false)
    setReviewResult(null)
    try {
      const result = await discountReviewMutation.mutateAsync({
        fiscal_year_uuid: activeFiscalYearUuid,
        force_full: forceFullRecalc,
      })
      setReviewResult(result)
    } catch {
      // Error handled by the mutation
    } finally {
      setForceFullRecalc(false)
    }
  }

  async function handleMemberRecalc(memberUuid: string, forceFull = false) {
    if (!activeFiscalYearUuid) return
    setMemberRecalcState((prev) => ({ ...prev, [memberUuid]: { status: 'running' } }))
    try {
      const result = await memberDiscountReviewMutation.mutateAsync({
        memberUuid,
        fiscal_year_uuid: activeFiscalYearUuid,
        force_full: forceFull,
      })
      setMemberRecalcState((prev) => ({ ...prev, [memberUuid]: { status: 'done', result } }))
    } catch {
      setMemberRecalcState((prev) => ({ ...prev, [memberUuid]: { status: 'idle' } }))
    }
  }

  const items = purchases?.items ?? []
  const totalPages = purchases?.total_pages ?? 1
  const totalCount = purchases?.total_count ?? 0

  function exportToPdf() {
    const head = [[
      t('ops.packs.member', 'Membre'),
      t('ops.packs.pack', 'Forfait'),
      t('ops.packs.date', 'Date'),
      t('ops.packs.qtyBought', 'Acheté'),
      t('ops.packs.qtyRemaining', 'Restant'),
      t('ops.packs.price', 'Montant'),
      t('ops.packs.totalDiscount', 'Remise'),
    ]]
    const body: (string | number)[][] = []
    for (const p of items) {
      body.push([
        p.member_name ?? p.member_uuid,
        p.pack_code ?? p.pack_type ?? '',
        p.entry_date ?? '',
        String(p.units_purchased),
        String(p.units_remaining),
        `${Number(p.amount).toFixed(2)} EUR`,
        Number(p.total_discount) > 0 ? `${Number(p.total_discount).toFixed(2)} EUR` : '—',
      ])
    }
    exportTableToPdf({
      title: t('ops.packs.title', 'Forfaits'),
      subtitle: `Export du ${new Date().toLocaleDateString('fr-FR')}`,
      head,
      body,
      filename: `forfaits-${new Date().toISOString().slice(0, 10)}.pdf`,
    })
  }

  // Detect member boundaries for visual grouping
  function isMemberBoundary(index: number): boolean {
    if (index === 0) return true
    return items[index].member_uuid !== items[index - 1].member_uuid
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('ops.packs.title', 'Forfaits')}
        </h2>
        <div className="flex items-center gap-2">
          {canPostEntries && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowConfirmDialog(true)}
              disabled={discountReviewMutation.isPending || !activeFiscalYearUuid}
            >
              {discountReviewMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              {discountReviewMutation.isPending
                ? t('ops.packs.discountReviewRunning', 'Calcul des remises…')
                : t('ops.packs.discountReview', 'Appliquer les remises')}
            </Button>
          )}
          {items.length > 0 && (
            <Button size="sm" variant="secondary" onClick={exportToPdf}>
              <Download className="mr-1 h-4 w-4" />
              {t('ops.packs.exportPdf', 'PDF')}
            </Button>
          )}
          {canManagePrices && (
            <Button size="sm" onClick={() => setShowPurchaseDialog(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('ops.packs.sell', 'Vendre un forfait')}
            </Button>
          )}
        </div>
      </div>

      {/* Pilot filter */}
      <div className="flex items-end gap-3">
        <div className="w-64 space-y-1">
          <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('ops.packs.filterPilot', 'Pilote')}
          </Label>
          <Input
            placeholder={t('ops.packs.filterPilotPlaceholder', 'Nom du pilote…')}
            value={filterPilot}
            onChange={(e) => {
              setFilterPilot(e.target.value)
              setPage(1)
            }}
          />
        </div>
        {filterPilot && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setFilterPilot('')
              setPage(1)
            }}
          >
            {t('common.clear', 'Effacer')}
          </Button>
        )}
        {totalCount > 0 && (
          <span className="pb-0.5 text-xs text-slate-500">
            {t('ops.packs.count', { defaultValue: '{{count}} forfait(s)', count: totalCount })}
          </span>
        )}
      </div>

      <PackPurchaseDialog
        open={showPurchaseDialog}
        onClose={() => setShowPurchaseDialog(false)}
      />

      <PackEditDialog
        open={editDialog !== null}
        onClose={() => setEditDialog(null)}
        entryUuid={editDialog?.entryUuid ?? ''}
        currentValidFrom={editDialog?.validFrom ?? ''}
      />

      {/* Discount Review Result Banner */}
      {reviewResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-sm font-medium text-emerald-900">
                  {t('ops.packs.discountReviewSuccess', {
                    defaultValue: 'Remises appliquées : {{flights}} vols recalculés, {{members}} membres concernés, {{total}} de remise totale.',
                    flights: reviewResult.flights_recalculated,
                    members: reviewResult.members_affected,
                    total: formatEur(reviewResult.total_discount),
                  })}
                </p>
                {reviewResult.details?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {reviewResult.details.map((d) => (
                      <li key={d.member_uuid} className="text-xs text-emerald-700">
                        {d.member_name} · {d.flights_count} vols · {formatEur(d.total_discount)}
                        {d.rem_entry_uuid && ' · REM: ' + d.rem_entry_uuid.slice(0, 8) + '…'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <button
              type="button"
              className="rounded p-1 text-emerald-500 hover:bg-emerald-100"
              onClick={() => setReviewResult(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowConfirmDialog(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {t('ops.packs.discountReview', 'Appliquer les remises')}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {t('ops.packs.discountReviewConfirm', 'Êtes-vous sûr de vouloir recalculer toutes les remises forfaits ?')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-start gap-2">
              <Checkbox
                id="force-full-recalc"
                checked={forceFullRecalc}
                onCheckedChange={(checked) => setForceFullRecalc(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="force-full-recalc" className="cursor-pointer text-sm font-normal text-slate-600">
                {t('ops.packs.forceFullRecalc', 'Recalcul complet (ignorer le mode incrémental)')}
                <span className="mt-0.5 block text-xs text-slate-400">
                  {t('ops.packs.forceFullRecalcHint', "Rejoue tout l'historique des vols de l'exercice au lieu de ne traiter que les vols jamais passés en revue. Plus lent, utile en cas de doute sur un résultat.")}
                </span>
              </Label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowConfirmDialog(false)}>
                {t('common.cancel', 'Annuler')}
              </Button>
              <Button onClick={handleDiscountReview} disabled={discountReviewMutation.isPending}>
                {discountReviewMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {t('ops.packs.discountReview', 'Appliquer les remises')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : !items.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          {t('ops.packs.empty', 'Aucun forfait acheté pour cet exercice.')}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="w-8 px-2 py-3" />
                  <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.member', 'Membre')}</th>
                  <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.pack', 'Forfait')}</th>
                  <th className="px-4 py-3 font-medium text-slate-600">{t('ops.packs.date', 'Date')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('ops.packs.qtyBought', 'Acheté')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('ops.packs.qtyRemaining', 'Restant')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('ops.packs.price', 'Montant')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('ops.packs.totalDiscount', 'Remise')}</th>
                  <th className="w-32 px-4 py-3 text-right font-medium text-slate-600">{t('ops.packs.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((p: PackPurchaseLine, index: number) => {
                  const recalcState = memberRecalcState[p.member_uuid]
                  const isNewMember = isMemberBoundary(index)
                  return (
                    <Fragment key={p.entry_uuid}>
                      {/* Member group separator */}
                      {isNewMember && index > 0 && (
                        <tr key={`sep-${p.member_uuid}`}>
                          <td colSpan={9} className="border-t-2 border-slate-200 bg-slate-50/60 px-4 py-1.5">
                            <span className="text-xs font-semibold text-slate-500">
                              {p.member_name ?? p.member_uuid}
                            </span>
                          </td>
                        </tr>
                      )}
                      {/* First row for a member: show name with subtle left indicator */}
                      <tr className={isNewMember ? 'bg-slate-50/30' : ''}>
                        <td className="px-2 py-3">
                          {p.consumptions?.length > 0 && (
                            <button
                              type="button"
                              className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                              onClick={() => setExpandedEntry(expandedEntry === p.entry_uuid ? null : p.entry_uuid)}
                            >
                              {expandedEntry === p.entry_uuid ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-900">
                          {isNewMember ? (
                            <span className="font-medium">{p.member_name ?? p.member_uuid}</span>
                          ) : (
                            <span className="text-slate-400">↳</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">{p.pack_code ?? p.pack_type}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{p.entry_date ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-900">{p.units_purchased}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-900">{p.units_remaining}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-900">{formatEur(p.amount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                          {Number(p.total_discount) > 0 ? (
                            <span className="text-blue-700">{formatEur(p.total_discount)}</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canManagePrices && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditDialog({ entryUuid: p.entry_uuid, validFrom: p.valid_from ?? '' })}
                                title={t('ops.packs.editPack', 'Modifier le prix')}
                              >
                                <Pencil className="h-3.5 w-3.5 text-slate-400" />
                              </Button>
                            )}
                            {canPostEntries && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleMemberRecalc(p.member_uuid)}
                                disabled={recalcState?.status === 'running' || !activeFiscalYearUuid}
                                title={t('ops.packs.recalcMember', 'Recalculer les remises pour ce membre')}
                              >
                                {recalcState?.status === 'running' ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : recalcState?.status === 'done' ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                            {canPostEntries && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleMemberRecalc(p.member_uuid, true)}
                                disabled={recalcState?.status === 'running' || !activeFiscalYearUuid}
                                title={t('ops.packs.recalcMemberFull', 'Recalcul complet forcé pour ce membre')}
                              >
                                <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Expanded: consumption flights detail */}
                      {expandedEntry === p.entry_uuid && p.consumptions?.length > 0 && (
                        <tr key={`${p.entry_uuid}-detail`}>
                          <td colSpan={9} className="bg-slate-50 px-6 py-4">
                            <div className="space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {t('ops.packs.flightsInvolved', 'Vols concernés')}
                              </p>
                              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="w-full text-left text-xs">
                                  <thead className="border-b border-slate-200 bg-slate-100">
                                    <tr>
                                      <th className="px-3 py-2 font-medium text-slate-600">{t('ops.packs.flightDate', 'Date')}</th>
                                      <th className="px-3 py-2 font-medium text-slate-600">{t('ops.packs.assetCode', 'Machine')}</th>
                                      <th className="px-3 py-2 text-right font-medium text-slate-600">{t('ops.packs.qtyConsumed', 'Qté cons.')}</th>
                                      <th className="px-3 py-2 text-right font-medium text-slate-600">{t('ops.packs.unitDiscount', 'Remise unit.')}</th>
                                      <th className="px-3 py-2 text-right font-medium text-slate-600">{t('ops.packs.totalDiscount', 'Remise totale')}</th>
                                      <th className="px-3 py-2 font-medium text-slate-600">{t('ops.packs.validFrom', 'Valide dès')}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {p.consumptions.map((c) => (
                                      <tr key={c.consumption_uuid}>
                                        <td className="px-3 py-2 text-slate-900">{c.flight_date ?? '—'}</td>
                                        <td className="px-3 py-2 text-slate-700">{c.asset_code ?? '—'}</td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-900">{c.quantity_consumed}</td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-900">{formatEur(c.discount_unit_price)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-900">{formatEur(c.total_discount_amount)}</td>
                                        <td className="px-3 py-2 text-slate-600">{c.valid_from ?? '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {recalcState?.status === 'done' && recalcState.result && (
                                <p className="text-xs text-emerald-600">
                                  <CheckCircle2 className="mr-0.5 inline h-3 w-3" />
                                  {recalcState.result.flights_recalculated} vols · {formatEur(recalcState.result.total_discount)} de remise
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('common.prev', 'Précédent')}
              </Button>
              <span className="px-2 text-sm text-slate-700">
                {t('common.pageInfo', { defaultValue: 'Page {{page}}/{{total}}', page, total: totalPages })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('common.next', 'Suivant')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
