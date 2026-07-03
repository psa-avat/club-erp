/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation: saved CSV column mapping manager
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
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { useCreateCsvMappingMutation, useCsvMappingsQuery, useDeleteCsvMappingMutation } from '../api'

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']
const COLUMN_FIELDS = [
  { key: 'date', required: true },
  { key: 'description', required: false },
  { key: 'amount', required: false },
  { key: 'debit', required: false },
  { key: 'credit', required: false },
  { key: 'reference', required: false },
  { key: 'counterparty', required: false },
] as const

interface Props {
  open: boolean
  onClose: () => void
}

export function CsvMappingWizard({ open, onClose }: Props) {
  const { t } = useTranslation('banque')

  const [name, setName] = useState('')
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY')
  const [separator, setSeparator] = useState('')
  const [encoding, setEncoding] = useState('')
  const [columns, setColumns] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const { data: mappings } = useCsvMappingsQuery(open)
  const createMutation = useCreateCsvMappingMutation()
  const deleteMutation = useDeleteCsvMappingMutation()

  function reset() {
    setName('')
    setDateFormat('DD/MM/YYYY')
    setSeparator('')
    setEncoding('')
    setColumns({})
    setError(null)
  }

  async function handleCreate() {
    if (!name.trim() || !columns.date?.trim()) {
      setError(t('reconciliation.csvMapping.dateRequired', 'La colonne de date est requise.'))
      return
    }
    if (!columns.amount?.trim() && !(columns.debit?.trim() && columns.credit?.trim())) {
      setError(t('reconciliation.csvMapping.amountRequired', 'Renseignez la colonne montant, ou débit + crédit.'))
      return
    }
    setError(null)
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        column_mapping: Object.fromEntries(Object.entries(columns).filter(([, v]) => v.trim())),
        separator: separator.trim() || undefined,
        encoding: encoding.trim() || undefined,
        date_format: dateFormat,
      })
      toast.success(t('reconciliation.csvMapping.saved', 'Mapping enregistré'))
      reset()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('reconciliation.csvMapping.error', "Échec de l'enregistrement"))
    }
  }

  async function handleDelete(uuid: string) {
    await deleteMutation.mutateAsync(uuid)
    toast.success(t('reconciliation.csvMapping.deleted', 'Mapping supprimé'))
  }

  return (
    <Dialog open={open} onClose={() => { reset(); onClose() }}>
      <DialogContent className="sm:max-w-xl" aria-labelledby="csv-mapping-wizard-title">
        <div className="space-y-4">
          <div>
            <h2 id="csv-mapping-wizard-title" className="text-lg font-semibold text-foreground">
              {t('reconciliation.csvMapping.title', 'Mappings CSV')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('reconciliation.csvMapping.description', 'Associez les colonnes de votre export CSV bancaire.')}
            </p>
          </div>

          {(mappings ?? []).length > 0 && (
            <ul className="space-y-1 rounded-lg border bg-card p-2">
              {(mappings ?? []).map((m) => (
                <li key={m.uuid} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm">
                  <span>{m.name} <span className="text-muted-foreground">({m.date_format})</span></span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(m.uuid)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t('reconciliation.csvMapping.delete', 'Supprimer')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3 border-t pt-3">
            <div className="space-y-1">
              <Label>{t('reconciliation.csvMapping.name', 'Nom')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {COLUMN_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label>
                    {t(`reconciliation.csvMapping.columns.${field.key}`, field.key)}
                    {field.required && ' *'}
                  </Label>
                  <Input
                    value={columns[field.key] ?? ''}
                    onChange={(e) => setColumns((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={t('reconciliation.csvMapping.columnPlaceholder', 'Nom de colonne')}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>{t('reconciliation.csvMapping.dateFormat', 'Format de date')}</Label>
                <select
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t('reconciliation.csvMapping.separator', 'Séparateur')}</Label>
                <Input value={separator} onChange={(e) => setSeparator(e.target.value)} placeholder=";" />
              </div>
              <div className="space-y-1">
                <Label>{t('reconciliation.csvMapping.encoding', 'Encodage')}</Label>
                <Input value={encoding} onChange={(e) => setEncoding(e.target.value)} placeholder="utf-8" />
              </div>
            </div>

            {error && <p className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            <div className="flex justify-end">
              <Button type="button" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending
                  ? t('reconciliation.csvMapping.saving', 'Enregistrement…')
                  : t('reconciliation.csvMapping.save', 'Enregistrer le mapping')}
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" variant="ghost" onClick={() => { reset(); onClose() }}>
              {t('reconciliation.csvMapping.close', 'Fermer')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
