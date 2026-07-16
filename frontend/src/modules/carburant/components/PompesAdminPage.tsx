/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant: PompesAdminPage — pump CRUD, QR code preview/download, token rotation
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
import { Plus, Pencil, QrCode } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirmation-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import {
  pleinUrl,
  usePompeQrCodeQuery,
  usePompesQuery,
  useCreatePompeMutation,
  useRotatePompeTokenMutation,
  useUpdatePompeMutation,
  type Pompe,
  type PompeCreateRequest,
} from '../api'

const TYPE_CARBURANT_VALUES = [1, 2, 3] as const

type PompeFormState = {
  nom: string
  type_carburant: number
  actif: boolean
  capacite_cuve_l: string
  index_initial: string
  index_initial_date: string
}

const defaultForm: PompeFormState = {
  nom: '',
  type_carburant: 1,
  actif: true,
  capacite_cuve_l: '',
  index_initial: '',
  index_initial_date: '',
}

function pompeToForm(p: Pompe): PompeFormState {
  return {
    nom: p.nom,
    type_carburant: p.type_carburant,
    actif: p.actif,
    capacite_cuve_l: p.capacite_cuve_l ?? '',
    index_initial: p.index_initial ?? '',
    index_initial_date: p.index_initial_date ?? '',
  }
}

function formToPayload(form: PompeFormState): PompeCreateRequest {
  return {
    nom: form.nom,
    type_carburant: form.type_carburant,
    actif: form.actif,
    capacite_cuve_l: form.capacite_cuve_l.trim() ? form.capacite_cuve_l.trim() : null,
    index_initial: form.index_initial.trim() ? form.index_initial.trim() : null,
    index_initial_date: form.index_initial_date.trim() ? form.index_initial_date.trim() : null,
  }
}

function QrCodeDialog({ pompe, onClose }: { pompe: Pompe; onClose: () => void }) {
  const { t } = useTranslation('carburant')
  const qrQuery = usePompeQrCodeQuery(pompe.uuid, true)
  const url = pleinUrl(pompe.token)

  function handleDownload() {
    if (!qrQuery.data) return
    const blob = new Blob([qrQuery.data], { type: 'image/svg+xml' })
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `qr-${pompe.nom.replace(/\s+/g, '-').toLowerCase()}.svg`
    a.click()
    URL.revokeObjectURL(blobUrl)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    toast.success(t('admin.pompes.qrDialog.linkCopied'))
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.pompes.qrDialog.title', { nom: pompe.nom })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          {qrQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : qrQuery.data ? (
            <div
              className="h-56 w-56 [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: qrQuery.data }}
            />
          ) : null}
          <div className="w-full space-y-1">
            <Label>{t('admin.pompes.qrDialog.url')}</Label>
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          </div>
          <div className="flex w-full justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleCopy}>
              {t('admin.pompes.qrDialog.copyLink')}
            </Button>
            <Button type="button" onClick={handleDownload} disabled={!qrQuery.data}>
              {t('admin.pompes.qrDialog.download')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PompesAdminPage() {
  const { t } = useTranslation('carburant')

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingUuid, setEditingUuid] = useState<string | null>(null)
  const [form, setForm] = useState<PompeFormState>(defaultForm)
  const [qrPompe, setQrPompe] = useState<Pompe | null>(null)
  const [rotateUuid, setRotateUuid] = useState<string | null>(null)

  const { data: pompes = [], isLoading } = usePompesQuery()
  const createMutation = useCreatePompeMutation()
  const updateMutation = useUpdatePompeMutation()
  const rotateMutation = useRotatePompeTokenMutation()

  function openCreate() {
    setEditingUuid(null)
    setForm(defaultForm)
    setSheetOpen(true)
  }

  function openEdit(pompe: Pompe) {
    setEditingUuid(pompe.uuid)
    setForm(pompeToForm(pompe))
    setSheetOpen(true)
  }

  function handleField<K extends keyof PompeFormState>(field: K, value: PompeFormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = formToPayload(form)
    try {
      if (editingUuid) {
        await updateMutation.mutateAsync({ uuid: editingUuid, body: payload })
        toast.success(t('admin.pompes.edit') + ' — OK')
      } else {
        await createMutation.mutateAsync(payload)
        toast.success(t('admin.pompes.add') + ' — OK')
      }
      setSheetOpen(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('admin.pompes.add')}
        </Button>
      </div>

      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">…</p>
      ) : pompes.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t('admin.pompes.noResults')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.pompes.columns.nom')}</TableHead>
                <TableHead>{t('admin.pompes.columns.typeCarburant')}</TableHead>
                <TableHead>{t('admin.pompes.columns.actif')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pompes.map((pompe) => (
                <TableRow key={pompe.uuid}>
                  <TableCell className="font-medium">{pompe.nom}</TableCell>
                  <TableCell>{t(`typeCarburant.${pompe.type_carburant}`)}</TableCell>
                  <TableCell>
                    <Badge className={pompe.actif ? 'badge-success' : 'badge-destructive'}>
                      {pompe.actif ? t('admin.pompes.fields.actif') : '—'}
                    </Badge>
                  </TableCell>
                  <TableCell className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setQrPompe(pompe)} title={t('admin.pompes.actions.qrcode')}>
                      <QrCode className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(pompe)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
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
            <SheetTitle>{editingUuid ? t('admin.pompes.edit') : t('admin.pompes.add')}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1">
              <Label>{t('admin.pompes.fields.nom')}</Label>
              <Input value={form.nom} onChange={(e) => handleField('nom', e.target.value)} required />
            </div>

            <div className="space-y-1">
              <Label>{t('admin.pompes.fields.typeCarburant')}</Label>
              <Select
                value={String(form.type_carburant)}
                onValueChange={(v) => handleField('type_carburant', Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_CARBURANT_VALUES.map((v) => (
                    <SelectItem key={v} value={String(v)}>
                      {t(`typeCarburant.${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>{t('admin.pompes.fields.capaciteCuveL')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.capacite_cuve_l}
                onChange={(e) => handleField('capacite_cuve_l', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('admin.pompes.fields.indexInitial')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.index_initial}
                  onChange={(e) => handleField('index_initial', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('admin.pompes.fields.indexInitialDate')}</Label>
                <Input
                  type="date"
                  value={form.index_initial_date}
                  onChange={(e) => handleField('index_initial_date', e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch id="pompe-actif" checked={form.actif} onCheckedChange={(v) => handleField('actif', v)} />
              <Label htmlFor="pompe-actif">{t('admin.pompes.fields.actif')}</Label>
            </div>

            {editingUuid && (
              <div>
                <Button type="button" variant="outline" onClick={() => setRotateUuid(editingUuid)}>
                  {t('admin.pompes.actions.rotateToken')}
                </Button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>
                {t('admin.pompes.cancel')}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? t('admin.pompes.saving') : t('admin.pompes.save')}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {qrPompe && <QrCodeDialog pompe={qrPompe} onClose={() => setQrPompe(null)} />}

      <ConfirmDialog
        open={rotateUuid !== null}
        title={t('admin.pompes.rotateConfirm.title')}
        body={t('admin.pompes.rotateConfirm.body')}
        variant="destructive"
        onConfirm={async () => {
          if (rotateUuid) {
            await rotateMutation.mutateAsync(rotateUuid)
            setRotateUuid(null)
          }
        }}
        onCancel={() => setRotateUuid(null)}
      />
    </div>
  )
}
