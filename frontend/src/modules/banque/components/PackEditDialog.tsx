/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: PackEditDialog — edit a sold pack price
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
import { Loader2 } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useUpdatePackPurchaseMutation } from '../api'

interface PackEditDialogProps {
  open: boolean
  onClose: () => void
  entryUuid: string
  currentPrice: string
}

export function PackEditDialog({ open, onClose, entryUuid, currentPrice }: PackEditDialogProps) {
  const { t } = useTranslation(['banque', 'common'])
  const [price, setPrice] = useState(currentPrice)
  const updateMutation = useUpdatePackPurchaseMutation()

  if (!open) return null

  async function handleSave() {
    if (!price || Number(price) <= 0) return
    await updateMutation.mutateAsync({ entryUuid, price })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900">
          {t('ops.packs.editTitle', 'Modifier le prix')}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t('ops.packs.editDescription', 'Modifier le prix de vente du forfait.')}
        </p>

        <div className="mt-4 space-y-1">
          <Label>{t('ops.packs.price', 'Prix de vente (EUR)')}</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={updateMutation.isPending}>
            {t('common.cancel', 'Annuler')}
          </Button>
          <Button onClick={handleSave} disabled={!price || Number(price) <= 0 || updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t('common.save', 'Enregistrer')}
          </Button>
        </div>
      </div>
    </div>
  )
}
