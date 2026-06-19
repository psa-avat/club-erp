/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Plan Comptable Général (PCG) seed management page
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
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useCapability } from '../../../auth/hooks/useCapability'
import { useApplyPcgSeedMutation, useImportPcgSeedMutation, usePcgSeedQuery } from '../api'
import type { PcgSeedItem } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function toErrorMessages(error: unknown): string[] {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: string } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'object' && detail !== null && 'errors' in detail) {
      const maybeErrors = (detail as { errors?: unknown }).errors
      if (Array.isArray(maybeErrors)) {
        const messages = maybeErrors.filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        )
        if (messages.length > 0) return messages
      }
    }

    if (typeof detail === 'string' && detail.length > 0) return [detail]
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string }
      if (typeof first?.msg === 'string' && first.msg.length > 0) return [first.msg]
    }
    if (typeof response?.data?.message === 'string' && response.data.message.length > 0)
      return [response.data.message]
  }
  return ['Unexpected error']
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BanquePcgPage() {
  const { t } = useTranslation('banque')
  const canManage = useCapability('MANAGE_SYSTEM_SETTINGS')

  const pcgSeedQuery = usePcgSeedQuery()
  const importMutation = useImportPcgSeedMutation()
  const applyMutation = useApplyPcgSeedMutation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const serverItems = pcgSeedQuery.data?.items ?? []
  const [draftItems, setDraftItems] = useState<PcgSeedItem[]>(serverItems)
  const [jsonText, setJsonText] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setDraftItems(serverItems)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcgSeedQuery.data])

  function updateItem(index: number, patch: Partial<PcgSeedItem>) {
    setDraftItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)))
  }

  function addRow() {
    setDraftItems((prev) => [
      ...prev,
      { code: '', name: '', type: 1, is_posting_allowed: true, is_reconcilable: false, require_id: 0 },
    ])
  }

  function removeRow(index: number) {
    setDraftItems((prev) => prev.filter((_, idx) => idx !== index))
  }

  async function saveToServer() {
    setLocalError(null)
    if (draftItems.length === 0) {
      setLocalError(t('pcg.emptyImportError'))
      return
    }
    await importMutation.mutateAsync({ items: draftItems })
  }

  async function applySeedToDatabase() {
    await applyMutation.mutateAsync()
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(draftItems, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'pcg_seed.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  function parseAndSetItems(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        setLocalError(t('pcg.invalidJsonError'))
        return
      }
      const normalized = parsed.map((row) => {
        const item = row as Record<string, unknown>
        return {
          code: String(item.code ?? ''),
          name: String(item.name ?? ''),
          type: Number(item.type ?? 1),
          is_posting_allowed: Boolean(item.is_posting_allowed ?? true),
          is_reconcilable: Boolean(item.is_reconcilable ?? false),
          require_id: Number(item.require_id ?? 0),
        } satisfies PcgSeedItem
      })
      setDraftItems(normalized)
    } catch {
      setLocalError(t('pcg.invalidJsonError'))
    }
  }

  function loadJsonFromText() {
    setLocalError(null)
    parseAndSetItems(jsonText)
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setLocalError(null)
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      parseAndSetItems((e.target?.result as string) ?? '')
    }
    reader.readAsText(file, 'utf-8')
    event.target.value = ''
  }

  const combinedError = importMutation.error ?? applyMutation.error

  const combinedErrorMessages = combinedError ? toErrorMessages(combinedError) : []
  if (!canManage) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('settings.noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2">
          <Link
            to="/banque"
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            ← {t('pcg.backToAccounting')}
          </Link>
        </div>
        <h1 className="text-xl font-semibold text-slate-900">{t('pcg.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('pcg.description')}</p>
      </div>

      {/* Main panel */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {pcgSeedQuery.isLoading ? (
          <p className="text-sm text-slate-500">{t('settings.loading')}</p>
        ) : (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={addRow}>
                {t('pcg.addRow')}
              </Button>
              <Button disabled={importMutation.isPending} type="button" onClick={() => void saveToServer()}>
                {t('pcg.saveJson')}
              </Button>
              <Button disabled={applyMutation.isPending} type="button" onClick={() => void applySeedToDatabase()}>
                {t('pcg.applyToDb')}
              </Button>
              <Button type="button" variant="ghost" onClick={exportJson}>
                {t('pcg.exportJson')}
              </Button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('pcg.columns.code')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('pcg.columns.name')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('pcg.columns.type')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('pcg.columns.posting')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('pcg.columns.reconcilable')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('pcg.columns.requireId')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('pcg.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {draftItems.map((item, index) => (
                    <tr key={`${item.code}-${index}`}>
                      <td className="px-3 py-2">
                        <Input
                          value={item.code}
                          onChange={(e) => updateItem(index, { code: e.target.value })}
                          className="h-7 text-xs font-mono"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={item.name}
                          onChange={(e) => updateItem(index, { name: e.target.value })}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          min={1}
                          max={5}
                          type="number"
                          value={String(item.type)}
                          onChange={(e) => updateItem(index, { type: Number(e.target.value) || 1 })}
                          className="h-7 w-16 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          checked={item.is_posting_allowed}
                          type="checkbox"
                          onChange={(e) => updateItem(index, { is_posting_allowed: e.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          checked={item.is_reconcilable}
                          type="checkbox"
                          onChange={(e) => updateItem(index, { is_reconcilable: e.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={item.require_id}
                          onChange={(e) => updateItem(index, { require_id: Number(e.target.value) })}
                          className="h-7 rounded border border-slate-300 bg-white px-1 text-xs"
                        >
                          <option value={0}>{t('pcg.requireId.none')}</option>
                          <option value={1}>{t('pcg.requireId.member')}</option>
                          <option value={2}>{t('pcg.requireId.asset')}</option>
                          <option value={3}>{t('pcg.requireId.supplier')}</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="ghost" type="button" onClick={() => removeRow(index)}>
                          {t('pcg.delete')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {draftItems.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-sm text-slate-500">
                        {t('pcg.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* JSON import area */}
            <div className="space-y-2">
              <Label htmlFor="pcg-json">{t('pcg.importLabel')}</Label>
              <textarea
                id="pcg-json"
                className="min-h-32 w-full rounded-md border border-slate-300 p-2 text-sm font-mono"
                placeholder='[{"code":"411","name":"Membres - Creances","type":1,"is_posting_allowed":true,"is_reconcilable":true}]'
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="button" onClick={loadJsonFromText}>
                  {t('pcg.importFromText')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => fileInputRef.current?.click()}>
                  {t('pcg.uploadButton')}
                </Button>
                <input
                  ref={fileInputRef}
                  accept=".json,application/json"
                  className="hidden"
                  type="file"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            {localError && <Alert>{localError}</Alert>}
            {combinedErrorMessages.length > 0 && (
              <Alert>
                {combinedErrorMessages.length === 1 ? (
                  combinedErrorMessages[0]
                ) : (
                  <ul className="list-disc space-y-1 pl-5">
                    {combinedErrorMessages.map((message, index) => (
                      <li key={`${message}-${index}`}>{message}</li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
