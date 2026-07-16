/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - carburant: ValidationQueuePage — review declared fill-ups (validate/reject)
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
import { Check, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import { useMouvementsQuery, useRejeterMouvementMutation, useValiderMouvementMutation, type MouvementCarburant } from '../api'

const STATUT_BADGE_CLASS: Record<number, string> = {
  1: 'badge-warning',
  2: 'badge-success',
  3: 'badge-destructive',
}

function ValidateDialog({ mouvement, onClose }: { mouvement: MouvementCarburant; onClose: () => void }) {
  const { t } = useTranslation('carburant')
  const [comment, setComment] = useState('')
  const mutation = useValiderMouvementMutation()

  async function handleConfirm() {
    try {
      await mutation.mutateAsync({ uuid: mouvement.uuid, commentaire_validation: comment.trim() || undefined })
      onClose()
    } catch {
      toast.error('Erreur')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.validation.validateDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>{t('admin.validation.validateDialog.comment')}</Label>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('admin.validation.cancel')}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={mutation.isPending}>
            {t('admin.validation.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RejectDialog({ mouvement, onClose }: { mouvement: MouvementCarburant; onClose: () => void }) {
  const { t } = useTranslation('carburant')
  const [comment, setComment] = useState('')
  const mutation = useRejeterMouvementMutation()

  async function handleConfirm() {
    if (!comment.trim()) return
    try {
      await mutation.mutateAsync({ uuid: mouvement.uuid, commentaire_validation: comment.trim() })
      onClose()
    } catch {
      toast.error('Erreur')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.validation.rejectDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>{t('admin.validation.rejectDialog.commentRequired')}</Label>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} required />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('admin.validation.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={mutation.isPending || !comment.trim()}
          >
            {t('admin.validation.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ValidationQueuePage() {
  const { t } = useTranslation('carburant')
  const [statutFilter, setStatutFilter] = useState<string>('1')
  const [validateTarget, setValidateTarget] = useState<MouvementCarburant | null>(null)
  const [rejectTarget, setRejectTarget] = useState<MouvementCarburant | null>(null)

  const statut = statutFilter === 'all' ? undefined : Number(statutFilter)
  const { data: mouvements = [], isLoading } = useMouvementsQuery(statut)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="w-48 space-y-1">
          <Label>{t('admin.validation.filterStatut')}</Label>
          <Select value={statutFilter} onValueChange={setStatutFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t('admin.statut.1')}</SelectItem>
              <SelectItem value="2">{t('admin.statut.2')}</SelectItem>
              <SelectItem value="3">{t('admin.statut.3')}</SelectItem>
              <SelectItem value="all">—</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">…</p>
      ) : mouvements.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t('admin.validation.noResults')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.validation.columns.pompe')}</TableHead>
                <TableHead>{t('admin.validation.columns.avion')}</TableHead>
                <TableHead>{t('admin.validation.columns.quantite')}</TableHead>
                <TableHead>{t('admin.validation.columns.declarant')}</TableHead>
                <TableHead>{t('admin.validation.columns.date')}</TableHead>
                <TableHead>{t('admin.validation.columns.statut')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mouvements.map((m) => (
                <TableRow key={m.uuid}>
                  <TableCell className="font-medium">{m.pompe_nom}</TableCell>
                  <TableCell>{m.asset_registration ? `${m.asset_registration} — ${m.asset_name}` : m.asset_name}</TableCell>
                  <TableCell>
                    {m.quantite_l}
                    {m.flag_anomalie && (
                      <Badge className="badge-warning ml-2">{t('admin.validation.anomalyBadge')}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{m.membre_declarant}</TableCell>
                  <TableCell className="text-sm">{new Date(m.date_saisie).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge className={STATUT_BADGE_CLASS[m.statut]}>{t(`admin.statut.${m.statut}`)}</Badge>
                  </TableCell>
                  <TableCell className="flex justify-end gap-1">
                    {m.statut === 1 && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => setValidateTarget(m)} title={t('admin.validation.actions.valider')}>
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setRejectTarget(m)} title={t('admin.validation.actions.rejeter')}>
                          <X className="h-4 w-4 text-red-600" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {validateTarget && <ValidateDialog mouvement={validateTarget} onClose={() => setValidateTarget(null)} />}
      {rejectTarget && <RejectDialog mouvement={rejectTarget} onClose={() => setRejectTarget(null)} />}
    </div>
  )
}
