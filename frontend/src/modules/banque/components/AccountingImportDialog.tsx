/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Selective preview-then-apply importer for legacy CSV accounting exports
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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '../../../components/ui/dialog'
import { Button } from '../../../components/ui/button'
import { Label } from '../../../components/ui/label'
import type {
  FiscalYear,
  ImportPreviewEntry,
  ImportPreviewResponse,
  JournalOption,
} from '../api'
import {
  usePreviewAccountingImportMutation,
  useApplyAccountingImportMutation,
} from '../api'

type Step = 'configure' | 'preview' | 'done'

interface Props {
  open: boolean
  onClose: () => void
  fiscalYears: FiscalYear[]
  journals: JournalOption[]
  defaultFiscalYearUuid?: string
}

export function AccountingImportDialog({
  open,
  onClose,
  fiscalYears,
  journals,
  defaultFiscalYearUuid,
}: Props) {
  const { t } = useTranslation('banque')

  const [step, setStep] = useState<Step>('configure')
  const [fiscalYearUuid, setFiscalYearUuid] = useState(defaultFiscalYearUuid ?? '')
  const [journalUuid, setJournalUuid] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [doneResult, setDoneResult] = useState<{ imported: number; batch: string } | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const previewMutation = usePreviewAccountingImportMutation()
  const applyMutation = useApplyAccountingImportMutation()

  // Default journal to AN when journals load and none selected yet
  const anJournal = journals.find((j) => j.code === 'AN')

  function handleOpen() {
    // Reset on every open
    setStep('configure')
    setFile(null)
    setPreview(null)
    setSelected(new Set())
    setDoneResult(null)
    setApplyError(null)
    if (!journalUuid && anJournal) setJournalUuid(anJournal.uuid)
  }

  // Reset when dialog opens
  if (open && step === 'configure' && !file && journalUuid === '' && anJournal) {
    setJournalUuid(anJournal.uuid)
  }

  async function handlePreview() {
    if (!file || !fiscalYearUuid || !journalUuid) return
    setApplyError(null)
    const result = await previewMutation.mutateAsync({ file, fiscal_year_uuid: fiscalYearUuid, journal_uuid: journalUuid })
    setPreview(result)
    // Pre-select all importable entries
    setSelected(new Set(result.entries.filter((e) => e.importable).map((e) => e.entry_key)))
    setStep('preview')
  }

  async function handleApply() {
    if (!file || !preview) return
    setApplyError(null)
    try {
      const result = await applyMutation.mutateAsync({
        file,
        fiscal_year_uuid: preview.fiscal_year_uuid,
        journal_uuid: preview.journal_uuid,
        selected_keys: Array.from(selected),
      })
      setDoneResult({ imported: result.imported_count, batch: result.import_batch_id })
      setStep('done')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('journal.import.applyError')
      setApplyError(msg)
    }
  }

  function toggleEntry(key: string, importable: boolean) {
    if (!importable) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleClose() {
    handleOpen()
    onClose()
  }

  const importableEntries = preview?.entries.filter((e) => e.importable) ?? []
  const selectedCount = selected.size

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      className="max-w-3xl"
      aria-labelledby="import-dialog-title"
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="import-dialog-title" className="text-lg font-semibold text-slate-900">
              {t('journal.import.title')}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{t('journal.import.description')}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-slate-400 hover:text-slate-700"
            aria-label={t('journal.import.close')}
          >
            ✕
          </button>
        </div>

        {/* ── Step 1: Configure ── */}
        {step === 'configure' && (
          <div className="mt-6 space-y-4">
            <div className="space-y-1">
              <Label>{t('journal.entries.fiscalYear')}</Label>
              <select
                value={fiscalYearUuid}
                onChange={(e) => setFiscalYearUuid(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">{t('journal.entries.selectFiscalYear')}</option>
                {fiscalYears.map((fy) => (
                  <option key={fy.uuid} value={fy.uuid}>{fy.code} — {fy.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label>{t('journal.entries.journal')}</Label>
              <select
                value={journalUuid}
                onChange={(e) => setJournalUuid(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">{t('journal.import.selectJournal')}</option>
                {journals.map((j) => (
                  <option key={j.uuid} value={j.uuid}>{j.code} · {j.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label>{t('journal.import.csvFile')}</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-slate-500 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-slate-400">{t('journal.import.csvHint')}</p>
            </div>

            {previewMutation.isError && (
              <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                {t('journal.import.previewError')}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={handleClose}>{t('journal.import.cancel')}</Button>
              <Button
                type="button"
                disabled={!file || !fiscalYearUuid || !journalUuid || previewMutation.isPending}
                onClick={handlePreview}
              >
                {previewMutation.isPending ? t('journal.import.previewing') : t('journal.import.previewBtn')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {step === 'preview' && preview && (
          <div className="mt-6 space-y-4">
            {/* Summary bar */}
            <div className="flex flex-wrap gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm">
              <span className="text-green-700">
                ✓ {preview.importable_count} {t('journal.import.importable')}
              </span>
              {preview.blocked_count > 0 && (
                <span className="text-amber-700">
                  ⚠ {preview.blocked_count} {t('journal.import.blocked')}
                </span>
              )}
              <span className="ml-auto text-slate-500">
                {selectedCount} {t('journal.import.selected')}
              </span>
            </div>

            {/* Select all importable */}
            {importableEntries.length > 0 && (
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  className="text-blue-600 hover:underline"
                  onClick={() => setSelected(new Set(importableEntries.map((e) => e.entry_key)))}
                >
                  {t('journal.import.selectAll')}
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  className="text-slate-500 hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  {t('journal.import.deselectAll')}
                </button>
              </div>
            )}

            {/* Entry list */}
            <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
              {preview.entries.map((entry) => (
                <EntryPreviewRow
                  key={entry.entry_key}
                  entry={entry}
                  checked={selected.has(entry.entry_key)}
                  onToggle={toggleEntry}
                  t={t}
                />
              ))}
            </div>

            {applyError && (
              <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{applyError}</p>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setStep('configure')}>
                {t('journal.import.back')}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={handleClose}>{t('journal.import.cancel')}</Button>
                <Button
                  type="button"
                  disabled={selectedCount === 0 || applyMutation.isPending}
                  onClick={handleApply}
                >
                  {applyMutation.isPending
                    ? t('journal.import.applying')
                    : t('journal.import.applyBtn', { count: selectedCount })}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Done ── */}
        {step === 'done' && doneResult && (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg bg-green-50 px-4 py-4 text-sm text-green-800">
              <p className="font-semibold">{t('journal.import.doneTitle')}</p>
              <p className="mt-1">
                {t('journal.import.doneBody', { count: doneResult.imported, batch: doneResult.batch })}
              </p>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={handleClose}>{t('journal.import.close')}</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

// ── Entry preview row ────────────────────────────────────────────────────────

function EntryPreviewRow({
  entry,
  checked,
  onToggle,
  t,
}: {
  entry: ImportPreviewEntry
  checked: boolean
  onToggle: (key: string, importable: boolean) => void
  t: (key: string) => string
}) {
  const isBlocked = !entry.importable
  const isAlreadyImported = entry.already_imported

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        isAlreadyImported
          ? 'border-slate-200 bg-slate-50 opacity-60'
          : isBlocked
            ? 'border-amber-200 bg-amber-50'
            : checked
              ? 'border-blue-300 bg-blue-50'
              : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
          checked={checked}
          disabled={isBlocked}
          onChange={() => onToggle(entry.entry_key, entry.importable)}
          aria-label={entry.description}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-slate-900">{entry.description || '—'}</span>
            <span className="shrink-0 font-mono text-xs text-slate-500">
              D {entry.total_debit} / C {entry.total_credit}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
            <span>{entry.entry_date}</span>
            <span>{t('journal.entries.linesCount').replace('lignes', '').replace('lines', '').trim()} {entry.lines.length}</span>
            <span className="text-slate-400">rows {entry.row_start}–{entry.row_end}</span>
          </div>

          {isAlreadyImported && (
            <p className="mt-1 text-xs text-slate-500">{t('journal.import.alreadyImported')}</p>
          )}

          {entry.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {entry.errors.map((err, i) => (
                <li key={i} className="text-xs text-amber-700">⚠ {err}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
