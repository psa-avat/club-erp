/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant: StockPage — cumulative stock per pump, and pump refill entry
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
import { toast } from 'sonner'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import { useCreateRavitaillementMutation, usePompesQuery, useStockQuery } from '../api'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function StockPage() {
  const { t } = useTranslation('carburant')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [pompeUuid, setPompeUuid] = useState('')
  const [quantiteL, setQuantiteL] = useState('')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')

  const { data: stock = [], isLoading } = useStockQuery()
  const { data: pompes = [] } = usePompesQuery()
  const createMutation = useCreateRavitaillementMutation()

  function openCreate() {
    setPompeUuid('')
    setQuantiteL('')
    setDate(todayIso())
    setNote('')
    setSheetOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await createMutation.mutateAsync({
        pompe_uuid: pompeUuid,
        quantite_l: quantiteL,
        date_ravitaillement: date,
        note: note.trim() || undefined,
      })
      toast.success(t('admin.stock.addRavitaillement') + ' — OK')
      setSheetOpen(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('admin.stock.addRavitaillement')}
        </Button>
      </div>

      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">…</p>
      ) : stock.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t('admin.stock.noResults')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.stock.columns.pompe')}</TableHead>
                <TableHead>{t('admin.stock.columns.type')}</TableHead>
                <TableHead className="text-right">{t('admin.stock.columns.ravitaillements')}</TableHead>
                <TableHead className="text-right">{t('admin.stock.columns.consommation')}</TableHead>
                <TableHead className="text-right">{t('admin.stock.columns.stock')}</TableHead>
                <TableHead>{t('admin.stock.columns.derniereActivite')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.map((entry) => (
                <TableRow key={entry.pompe_uuid}>
                  <TableCell className="font-medium">{entry.pompe_nom}</TableCell>
                  <TableCell>{t(`typeCarburant.${entry.type_carburant}`)}</TableCell>
                  <TableCell className="text-right">{entry.total_ravitaillements_l}</TableCell>
                  <TableCell className="text-right">{entry.total_consommation_l}</TableCell>
                  <TableCell className="text-right font-semibold">{entry.stock_l}</TableCell>
                  <TableCell className="text-sm">
                    {entry.derniere_activite ? new Date(entry.derniere_activite).toLocaleString() : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('admin.stock.ravitaillementDialog.title')}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1">
              <Label>{t('admin.stock.ravitaillementDialog.fields.pompe')}</Label>
              <Select value={pompeUuid} onValueChange={setPompeUuid}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pompes.map((p) => (
                    <SelectItem key={p.uuid} value={p.uuid}>
                      {p.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>{t('admin.stock.ravitaillementDialog.fields.quantite')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={quantiteL}
                onChange={(e) => setQuantiteL(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label>{t('admin.stock.ravitaillementDialog.fields.date')}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>

            <div className="space-y-1">
              <Label>{t('admin.stock.ravitaillementDialog.fields.note')}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>
                {t('admin.stock.cancel')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending || !pompeUuid}>
                {createMutation.isPending ? t('admin.stock.saving') : t('admin.stock.save')}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
