/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: reusable CSV import dialog
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
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from './button'

export type ImportRowError = {
  row: number
  field: string | null
  message: string
}

export type ImportResult = {
  created: number
  updated?: number
  skipped: number
  errors: ImportRowError[]
}

export type ImportOptions = {
  updateExisting: boolean
}

type Props = {
  /** Dialog title */
  title: string
  /** Called with the selected file; must resolve to ImportResult */
  onUpload: (file: File, options: ImportOptions) => Promise<ImportResult>
  /** Optional href for downloading a sample CSV file */
  sampleCsvHref?: string
  /** Show a toggle allowing updates of existing records when supported by the endpoint */
  showUpdateExistingToggle?: boolean
  /** Called when the dialog should close */
  onClose: () => void
}

export function ImportDialog({
  title,
  onUpload,
  sampleCsvHref,
  showUpdateExistingToggle = false,
  onClose,
}: Props) {
  const { t } = useTranslation('common')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [updateExisting, setUpdateExisting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
    setResult(null)
    setUploadError(null)
  }

  const titleId = useRef(`import-dialog-title-${Math.random().toString(36).slice(2, 9)}`).current

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [handleEscape])

  const handleUpload = async () => {
    if (!selectedFile) return
    setIsUploading(true)
    setUploadError(null)
    try {
      const res = await onUpload(selectedFile, { updateExisting })
      setResult(res)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setUploadError(msg)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-2xl rounded-shape-md bg-surface p-6 shadow-surface-4"
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-on-surface">{title}</h2>
          <button
            className="text-on-surface-variant hover:text-on-surface"
            onClick={onClose}
            aria-label={t('import.close')}
          >
            ✕
          </button>
        </div>

        {/* Sample CSV link */}
        {sampleCsvHref && (
          <p className="mb-3 text-sm text-on-surface-variant">
            {t('import.sampleDownloadPrefix')}{' '}
            <a
              href={sampleCsvHref}
              download
              className="text-blue-600 underline hover:text-blue-800"
            >
              {t('import.sampleDownloadLink')}
            </a>
          </p>
        )}

        {/* File picker */}
        <div className="mb-4 flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('import.chooseFile')}
          </Button>
          <span className="text-sm text-on-surface-variant">
            {selectedFile ? selectedFile.name : t('import.noFileChosen')}
          </span>
        </div>

        {showUpdateExistingToggle && (
          <label className="mb-4 flex items-start gap-2 rounded-shape-xs border border-outline-variant p-3 text-sm text-on-surface">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={updateExisting}
              onChange={(event) => setUpdateExisting(event.target.checked)}
            />
            <span>
              <span className="font-medium">{t('import.updateExisting')}</span>
              <span className="block text-xs text-on-surface-variant">{t('import.updateExistingDescription')}</span>
            </span>
          </label>
        )}

        {/* Upload error */}
        {uploadError && (
          <p className="mb-3 rounded-shape-xs bg-error-container p-2 text-sm text-on-error-container">
            {uploadError}
          </p>
        )}

        {/* Results */}
        {result && (
          <div className="mb-4 space-y-2" aria-live="polite" role="status">
            <p className="text-sm text-on-surface">
              <span className="font-medium text-success">{t('import.created')}: {result.created}</span>
              {typeof result.updated === 'number' && (
                <>
                  {' · '}
                  <span className="font-medium text-blue-700">{t('import.updated')}: {result.updated}</span>
                </>
              )}
              {' · '}
              <span className="font-medium text-warning">{t('import.skipped')}: {result.skipped}</span>
              {result.errors.length > 0 && (
                <>
                  {' · '}
                  <span className="font-medium text-error">{t('import.errors')}: {result.errors.length}</span>
                </>
              )}
            </p>
            {result.errors.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-shape-xs border border-error-container">
                <table className="w-full text-xs">
                  <thead className="bg-error-container text-left">
                    <tr>
                      <th className="px-2 py-1 font-medium">{t('import.colRow')}</th>
                      <th className="px-2 py-1 font-medium">{t('import.colField')}</th>
                      <th className="px-2 py-1 font-medium">{t('import.colMessage')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((err, i) => (
                      <tr key={i} className="border-t border-outline-variant">
                        <td className="px-2 py-1">{err.row}</td>
                        <td className="px-2 py-1">{err.field ?? '—'}</td>
                        <td className="px-2 py-1">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('import.close')}
          </Button>
          <Button
            size="sm"
            disabled={!selectedFile || isUploading}
            onClick={handleUpload}
          >
            {isUploading ? t('import.uploading') : t('import.upload')}
          </Button>
        </div>
      </div>
    </div>
  )
}
