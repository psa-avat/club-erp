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
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from './button'

export type ImportRowError = {
  row: number
  field: string | null
  message: string
}

export type ImportResult = {
  created: number
  skipped: number
  errors: ImportRowError[]
}

type Props = {
  /** Dialog title */
  title: string
  /** Called with the selected file; must resolve to ImportResult */
  onUpload: (file: File) => Promise<ImportResult>
  /** Optional href for downloading a sample CSV file */
  sampleCsvHref?: string
  /** Called when the dialog should close */
  onClose: () => void
}

export function ImportDialog({ title, onUpload, sampleCsvHref, onClose }: Props) {
  const { t } = useTranslation('common')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
    setResult(null)
    setUploadError(null)
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setIsUploading(true)
    setUploadError(null)
    try {
      const res = await onUpload(selectedFile)
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
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            className="text-slate-400 hover:text-slate-600"
            onClick={onClose}
            aria-label={t('import.close')}
          >
            ✕
          </button>
        </div>

        {/* Sample CSV link */}
        {sampleCsvHref && (
          <p className="mb-3 text-sm text-slate-500">
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
          <span className="text-sm text-slate-600">
            {selectedFile ? selectedFile.name : t('import.noFileChosen')}
          </span>
        </div>

        {/* Upload error */}
        {uploadError && (
          <p className="mb-3 rounded bg-rose-50 p-2 text-sm text-rose-700">
            {uploadError}
          </p>
        )}

        {/* Results */}
        {result && (
          <div className="mb-4 space-y-2">
            <p className="text-sm text-slate-700">
              <span className="font-medium text-green-700">{t('import.created')}: {result.created}</span>
              {' · '}
              <span className="font-medium text-amber-600">{t('import.skipped')}: {result.skipped}</span>
              {result.errors.length > 0 && (
                <>
                  {' · '}
                  <span className="font-medium text-rose-600">{t('import.errors')}: {result.errors.length}</span>
                </>
              )}
            </p>
            {result.errors.length > 0 && (
              <div className="max-h-48 overflow-auto rounded border border-rose-200">
                <table className="w-full text-xs">
                  <thead className="bg-rose-50 text-left">
                    <tr>
                      <th className="px-2 py-1 font-medium">{t('import.colRow')}</th>
                      <th className="px-2 py-1 font-medium">{t('import.colField')}</th>
                      <th className="px-2 py-1 font-medium">{t('import.colMessage')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((err, i) => (
                      <tr key={i} className="border-t border-rose-100">
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
