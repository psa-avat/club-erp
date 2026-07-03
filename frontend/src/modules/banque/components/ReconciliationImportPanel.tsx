/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation: statement import dialog (OFX/QFX/CSV)
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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useAccountsQuery,
  useCsvMappingsQuery,
  useFiscalYearsQuery,
  useImportStatementMutation,
  useJournalsQuery,
} from '../api'

interface Props {
  open: boolean
  onClose: () => void
  defaultFiscalYearUuid?: string
  onImported: (statementUuid: string) => void
}

export function ReconciliationImportPanel({ open, onClose, defaultFiscalYearUuid, onImported }: Props) {
  const { t } = useTranslation('banque')

  const [fiscalYearUuid, setFiscalYearUuid] = useState(defaultFiscalYearUuid ?? '')
  const [journalUuid, setJournalUuid] = useState('')
  const [accountUuid, setAccountUuid] = useState('')
  const [csvMappingUuid, setCsvMappingUuid] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: fiscalYears } = useFiscalYearsQuery(open)
  const { data: journals } = useJournalsQuery(open)
  const { data: accounts } = useAccountsQuery(open)
  const { data: csvMappings } = useCsvMappingsQuery(open)
  const importMutation = useImportStatementMutation()

  const bankJournals = useMemo(
    () => (journals ?? []).filter((j) => (j.type === 3 || j.type === 4) && j.is_active),
    [journals],
  )
  const reconcilableAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.is_reconcilable && a.is_active !== false),
    [accounts],
  )

  const isCsv = file?.name.toLowerCase().endsWith('.csv') ?? false

  function reset() {
    setJournalUuid('')
    setAccountUuid('')
    setCsvMappingUuid('')
    setFile(null)
    setError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleImport() {
    if (!file || !fiscalYearUuid || !journalUuid || !accountUuid) return
    if (isCsv && !csvMappingUuid) {
      setError(t('reconciliation.import.csvMappingRequired', 'Un mapping CSV est requis pour ce format.'))
      return
    }
    setError(null)
    try {
      const statement = await importMutation.mutateAsync({
        file,
        fiscal_year_uuid: fiscalYearUuid,
        journal_uuid: journalUuid,
        account_uuid: accountUuid,
        csv_mapping_uuid: isCsv ? csvMappingUuid : undefined,
      })
      toast.success(t('reconciliation.import.success', 'Relevé importé ({{count}} lignes)', { count: statement.line_count }))
      reset()
      onImported(statement.uuid)
      onClose()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err instanceof Error ? err.message : t('reconciliation.import.error', "Échec de l'import"))
      setError(detail)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogContent className="sm:max-w-lg" aria-labelledby="reconciliation-import-title">
        <div className="space-y-4">
          <div>
            <h2 id="reconciliation-import-title" className="text-lg font-semibold text-foreground">
              {t('reconciliation.import.title', 'Importer un relevé bancaire')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('reconciliation.import.description', 'Formats supportés : OFX, QFX, CSV.')}
            </p>
          </div>

          <div className="space-y-1">
            <Label>{t('reconciliation.import.fiscalYear', 'Exercice')}</Label>
            <select
              value={fiscalYearUuid}
              onChange={(e) => setFiscalYearUuid(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{t('reconciliation.import.selectFiscalYear', 'Sélectionner un exercice')}</option>
              {(fiscalYears ?? []).map((fy) => (
                <option key={fy.uuid} value={fy.uuid}>{fy.code} — {fy.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>{t('reconciliation.import.journal', 'Journal Banque/Caisse')}</Label>
            <select
              value={journalUuid}
              onChange={(e) => { setJournalUuid(e.target.value); setAccountUuid('') }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{t('reconciliation.import.selectJournal', 'Sélectionner un journal')}</option>
              {bankJournals.map((j) => (
                <option key={j.uuid} value={j.uuid}>{j.code} · {j.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>{t('reconciliation.import.account', 'Compte bancaire/caisse')}</Label>
            <select
              value={accountUuid}
              onChange={(e) => setAccountUuid(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={!journalUuid}
            >
              <option value="">{t('reconciliation.import.selectAccount', 'Sélectionner un compte')}</option>
              {reconcilableAccounts.map((a) => (
                <option key={a.uuid} value={a.uuid}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>{t('reconciliation.import.file', 'Fichier de relevé')}</Label>
            <input
              type="file"
              accept=".ofx,.qfx,.csv,text/csv"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/80"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {isCsv && (
            <div className="space-y-1">
              <Label>{t('reconciliation.import.csvMapping', 'Mapping CSV')}</Label>
              <Select value={csvMappingUuid} onValueChange={setCsvMappingUuid}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder={t('reconciliation.import.selectCsvMapping', 'Sélectionner un mapping')} />
                </SelectTrigger>
                <SelectContent>
                  {(csvMappings ?? []).map((m) => (
                    <SelectItem key={m.uuid} value={m.uuid}>{m.name} ({m.date_format})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && <p className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>
              {t('reconciliation.import.cancel', 'Annuler')}
            </Button>
            <Button
              type="button"
              disabled={!file || !fiscalYearUuid || !journalUuid || !accountUuid || importMutation.isPending}
              onClick={handleImport}
            >
              {importMutation.isPending ? t('reconciliation.import.importing', 'Import…') : t('reconciliation.import.importBtn', 'Importer')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
