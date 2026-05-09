/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Onglet Fournisseurs — liste AP et saisie factures (Phase 2)
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
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'

import { Button } from '../../../components/ui/button'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useMemberOptionsQuery } from '../../members/api'
import {
  useAccountingEntriesQuery,
  useJournalsQuery,
  usePostAccountingEntryMutation,
  type AccountingEntry,
  type JournalOption,
} from '../api'
import {
  ENTRY_STATE_DRAFT,
  ENTRY_STATE_POSTED,
  OPS_STATUS,
  type OpsStatus,
  opsStatusBadgeClass,
  opsStatusLabel,
  toErrorMessage,
} from './journalShared'
import { SettlePaymentDialog } from './SettlePaymentDialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpsSupplierTabProps {
  fiscalYearUuid: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OVERDUE_DAYS = 30

function entryTotalAmount(entry: AccountingEntry): Decimal {
  return entry.lines.reduce((sum, l) => sum.plus(new Decimal(l.credit)), new Decimal(0))
}

function daysOld(entryDate: string): number {
  const diff = Date.now() - new Date(entryDate).getTime()
  return Math.floor(diff / 86_400_000)
}

function deriveApStatus(entry: AccountingEntry): OpsStatus {
  if (entry.state === ENTRY_STATE_DRAFT) return OPS_STATUS.DRAFT
  if (entry.state === ENTRY_STATE_POSTED) {
    return daysOld(entry.entry_date) > OVERDUE_DAYS ? OPS_STATUS.OVERDUE : OPS_STATUS.PENDING
  }
  return OPS_STATUS.ARCHIVED
}

function formatAmount(amount: Decimal): string {
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ApRowProps {
  entry: AccountingEntry
  status: OpsStatus
  onSettle: (entry: AccountingEntry) => void
  onPost: (entry: AccountingEntry) => void
  isPosting: boolean
  canPost: boolean
  supplierMemberLabel?: string
  t: (key: string) => string
}

function ApRow({ entry, status, onSettle, onPost, isPosting, canPost, supplierMemberLabel, t }: ApRowProps) {
  const amount = entryTotalAmount(entry)
  const age = daysOld(entry.entry_date)

  return (
    <tr className="group border-b border-slate-100 last:border-0 hover:bg-slate-50">
      {/* Supplier / description */}
      <td className="py-2.5 pl-4 pr-2 text-sm font-medium text-slate-800">
        <div className="space-y-0.5">
          <div>{entry.description}</div>
          {supplierMemberLabel ? (
            <div className="text-xs font-normal text-slate-500">
              {supplierMemberLabel}
            </div>
          ) : null}
        </div>
      </td>

      {/* Reference */}
      <td className="px-2 py-2.5 text-xs text-slate-500">
        {entry.reference ?? '—'}
      </td>

      {/* Date */}
      <td className="px-2 py-2.5 text-xs text-slate-500 tabular-nums">
        {entry.entry_date}
      </td>

      {/* Age / overdue */}
      <td className="px-2 py-2.5 text-xs tabular-nums">
        {entry.state === ENTRY_STATE_POSTED ? (
          <span className={age > OVERDUE_DAYS ? 'font-semibold text-error' : 'text-slate-500'}>
            {age}j
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>

      {/* Amount */}
      <td className="px-2 py-2.5 text-right text-sm font-mono tabular-nums text-slate-700">
        {formatAmount(amount)}
      </td>

      {/* Status badge */}
      <td className="px-2 py-2.5">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${opsStatusBadgeClass(status)}`}>
          {opsStatusLabel(status, t)}
        </span>
      </td>

      {/* Actions */}
      <td className="py-2.5 pl-2 pr-4 text-right">
        <div className="inline-flex gap-1">
          {entry.state === ENTRY_STATE_DRAFT && canPost && (
            <Button
              size="sm"
              variant="secondary"
              disabled={isPosting}
              onClick={() => onPost(entry)}
              aria-label={t('ops.suppliers.actions.post')}
            >
              {t('ops.suppliers.actions.post')}
            </Button>
          )}
          {entry.state === ENTRY_STATE_POSTED && canPost && (
            <Button
              size="sm"
              onClick={() => onSettle(entry)}
              aria-label={t('ops.suppliers.actions.settle')}
            >
              {t('ops.suppliers.actions.settle')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function OpsSupplierTab({ fiscalYearUuid }: OpsSupplierTabProps) {
  const { t } = useTranslation('banque')
  const navigate = useNavigate()
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')

  const membersQuery = useMemberOptionsQuery({ limit: 500 })
  const journalsQuery = useJournalsQuery()
  const postMutation = usePostAccountingEntryMutation()

  const [settleEntry, setSettleEntry] = useState<AccountingEntry | null>(null)
  const [postError, setPostError] = useState<string | null>(null)

  // Resolve HA and BQ journal UUIDs from the journal list
  const haJournal = useMemo<JournalOption | null>(
    () => journalsQuery.data?.find((j) => j.code === 'HA') ?? null,
    [journalsQuery.data],
  )

  const bqJournal = useMemo<JournalOption | null>(
    () => journalsQuery.data?.find((j) => j.code === 'BQ') ?? null,
    [journalsQuery.data],
  )

  // Fetch HA entries (drafts + posted)
  const entriesQuery = useAccountingEntriesQuery(
    {
      fiscal_year_uuid: fiscalYearUuid,
      journal_uuid: haJournal?.uuid,
      limit: 200,
    },
    Boolean(haJournal && fiscalYearUuid),
  )

  const entries = entriesQuery.data ?? []
  const members = membersQuery.data ?? []
  const memberLabelByUuid = useMemo(
    () => new Map(members.map((m) => [m.uuid, `${m.last_name} ${m.first_name} (${m.account_id})`])),
    [members],
  )

  function supplierMemberLabelFromEntry(entry: AccountingEntry): string | undefined {
    const supplierLine = entry.lines.find((line) =>
      line.member_uuid && new Decimal(line.credit).greaterThan(0),
    )
    if (!supplierLine?.member_uuid) return undefined
    return memberLabelByUuid.get(supplierLine.member_uuid)
  }

  // Separate into overdue/pending/draft for summary KPIs
  const { overdueCount, pendingTotal, draftCount } = useMemo(() => {
    let overdueCount = 0
    let pendingTotal = new Decimal(0)
    let draftCount = 0
    for (const e of entries) {
      const s = deriveApStatus(e)
      if (s === OPS_STATUS.OVERDUE) { overdueCount++; pendingTotal = pendingTotal.plus(entryTotalAmount(e)) }
      else if (s === OPS_STATUS.PENDING) { pendingTotal = pendingTotal.plus(entryTotalAmount(e)) }
      else if (s === OPS_STATUS.DRAFT) draftCount++
    }
    return { overdueCount, pendingTotal, draftCount }
  }, [entries])

  async function handlePost(entry: AccountingEntry) {
    setPostError(null)
    try {
      await postMutation.mutateAsync({ entryUuid: entry.uuid, fiscalYearUuid })
    } catch (err) {
      setPostError(toErrorMessage(err, t('ops.suppliers.postError')))
    }
  }

  const isLoading = journalsQuery.isLoading || entriesQuery.isLoading

  // ── Render ────────────────────────────────────────────────────────────────

  if (!haJournal && !journalsQuery.isLoading) {
    return (
      <div className="rounded-lg bg-warning-container px-4 py-3 text-sm text-on-warning-container">
        {t('ops.suppliers.noHaJournal')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">{t('ops.suppliers.kpi.overdue')}</p>
          <p className={`mt-1 text-2xl font-bold ${overdueCount > 0 ? 'text-error' : 'text-slate-700'}`}>
            {overdueCount}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">{t('ops.suppliers.kpi.pending')}</p>
          <p className="mt-1 text-2xl font-bold text-slate-700 font-mono">
            {formatAmount(pendingTotal)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">{t('ops.suppliers.kpi.draft')}</p>
          <p className="mt-1 text-2xl font-bold text-slate-700">{draftCount}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t('ops.suppliers.apList')}</h2>
        {canPost && haJournal && (
          <Button size="sm" onClick={() => navigate('/banque/factures-fournisseurs/new')}>
            + {t('ops.suppliers.newInvoice')}
          </Button>
        )}
      </div>

      {postError && (
        <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-sm text-on-error-container">
          {postError}
        </p>
      )}

      {/* AP Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-400">
            {t('ops.loading')}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-sm text-slate-500">{t('ops.suppliers.empty')}</p>
            {canPost && haJournal && (
              <Button size="sm" variant="secondary" onClick={() => navigate('/banque/factures-fournisseurs/new')}>
                {t('ops.suppliers.newInvoice')}
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="py-2 pl-4 pr-2">{t('ops.suppliers.col.supplier')}</th>
                <th className="px-2 py-2">{t('ops.suppliers.col.ref')}</th>
                <th className="px-2 py-2">{t('ops.suppliers.col.date')}</th>
                <th className="px-2 py-2">{t('ops.suppliers.col.age')}</th>
                <th className="px-2 py-2 text-right">{t('ops.suppliers.col.amount')}</th>
                <th className="px-2 py-2">{t('ops.suppliers.col.status')}</th>
                <th className="py-2 pl-2 pr-4 text-right">{t('ops.suppliers.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <ApRow
                  key={entry.uuid}
                  entry={entry}
                  status={deriveApStatus(entry)}
                  supplierMemberLabel={supplierMemberLabelFromEntry(entry)}
                  onSettle={setSettleEntry}
                  onPost={handlePost}
                  isPosting={postMutation.isPending}
                  canPost={canPost}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SettlePaymentDialog
        open={settleEntry !== null}
        onClose={() => setSettleEntry(null)}
        sourceEntry={settleEntry}
        bqJournal={bqJournal}
        fiscalYearUuid={fiscalYearUuid}
      />
    </div>
  )
}
