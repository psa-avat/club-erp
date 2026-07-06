/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Remise de chèque — select previously-recorded cheques and generate
      the batch deposit entry (5112 -> 512)
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
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'

import { Alert } from '../../../components/ui/alert'
import { Banner } from '../../../components/ui/banner'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import {
  useBanqueModuleSettingsQuery,
  useChequeCandidatesQuery,
  useCreateChequeRemittanceMutation,
} from '../api'
import { decimalOrZero, toErrorMessage } from './journalShared'

export function ChequeRemittancePage() {
  const { t } = useTranslation('banque')
  const today = new Date().toISOString().slice(0, 10)

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const settingsQuery = useBanqueModuleSettingsQuery('cheque_payments', true)

  const [includeDrafts, setIncludeDrafts] = useState(true)
  const [remittanceDate, setRemittanceDate] = useState(today)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const candidatesQuery = useChequeCandidatesQuery(activeFiscalYearUuid ?? '', includeDrafts, Boolean(activeFiscalYearUuid))
  const createRemittanceMutation = useCreateChequeRemittanceMutation()

  const candidates = candidatesQuery.data ?? []
  const rawSettings = settingsQuery.data?.settings ?? {}
  const settingsMissing = !rawSettings.pending_account_uuid || !rawSettings.bank_account_uuid

  function toggle(entryUuid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(entryUuid)) next.delete(entryUuid)
      else next.add(entryUuid)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(candidates.map((c) => c.entry_uuid)))
  }

  function deselectAll() {
    setSelected(new Set())
  }

  const selectedTotal = candidates
    .filter((c) => selected.has(c.entry_uuid))
    .reduce((sum, c) => sum.plus(decimalOrZero(c.amount)), new Decimal(0))

  async function handleGenerate() {
    if (!activeFiscalYearUuid || selected.size === 0) return
    setLocalError(null)
    setSuccessMessage(null)
    try {
      await createRemittanceMutation.mutateAsync({
        fiscal_year_uuid: activeFiscalYearUuid,
        remittance_date: remittanceDate,
        entry_uuids: Array.from(selected),
      })
      setSuccessMessage(t('cheque.remittance.success'))
      setSelected(new Set())
      await candidatesQuery.refetch()
    } catch (error) {
      setLocalError(toErrorMessage(error, t('cheque.remittance.error')))
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('cheque.remittance.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('cheque.remittance.description')}</p>
      </div>

      {localError && <Alert>{localError}</Alert>}
      {successMessage && <Banner variant="success" message={successMessage} onDismiss={() => setSuccessMessage(null)} />}
      {!activeFiscalYearUuid && <Alert>{t('creditCard.noFiscalYear')}</Alert>}
      {activeFiscalYearUuid && settingsMissing && <Alert>{t('cheque.remittance.settingsMissing')}</Alert>}

      <div className="flex flex-wrap items-end gap-4">
        <div className="max-w-xs space-y-1">
          <Label>{t('creditCard.entryDate')}</Label>
          <Input type="date" value={remittanceDate} onChange={(event) => setRemittanceDate(event.target.value)} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeDrafts}
            onChange={(event) => setIncludeDrafts(event.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          {t('cheque.remittance.includeDrafts')}
        </label>
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
        <div className="flex gap-2 text-sm">
          <button type="button" className="text-primary hover:underline" onClick={selectAll}>
            {t('cheque.remittance.selectAll')}
          </button>
          <span className="text-muted-foreground">|</span>
          <button type="button" className="text-muted-foreground hover:underline" onClick={deselectAll}>
            {t('cheque.remittance.deselectAll')}
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('cheque.remittance.empty')}</p>
        ) : (
          <div className="overflow-x-auto overflow-y-visible rounded-lg border bg-card">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('cheque.remittance.columns.date')}</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('cheque.remittance.columns.account')}</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('cheque.remittance.columns.tiers')}</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('cheque.remittance.columns.description')}</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">{t('cheque.remittance.columns.amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {candidates.map((candidate) => (
                  <tr key={candidate.entry_uuid}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(candidate.entry_uuid)}
                        onChange={() => toggle(candidate.entry_uuid)}
                        className="h-4 w-4 rounded border-input"
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{candidate.entry_date}</td>
                    <td className="px-3 py-2">{candidate.account_code}</td>
                    <td className="px-3 py-2">{candidate.tiers_display_name ?? '—'}</td>
                    <td className="px-3 py-2">{candidate.description}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{decimalOrZero(candidate.amount).toFixed(2)} €</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('cheque.remittance.selectedTotal')}</span>
          <span className="font-mono font-medium text-foreground">{selectedTotal.toFixed(2)} €</span>
        </div>
      </div>

      {activeFiscalYearUuid && !settingsMissing && selected.size === 0 && (
        <Alert>{t('cheque.remittance.noSelection')}</Alert>
      )}

      <Button
        type="button"
        disabled={!activeFiscalYearUuid || settingsMissing || selected.size === 0 || createRemittanceMutation.isPending}
        onClick={() => void handleGenerate()}
      >
        {createRemittanceMutation.isPending ? t('cheque.remittance.generating') : t('cheque.remittance.generate')}
      </Button>
    </section>
  )
}
