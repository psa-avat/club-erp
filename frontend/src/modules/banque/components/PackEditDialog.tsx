/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: PackEditDialog — edit a sold pack activation date
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
import { Label } from '../../../components/ui/label'
import { useUpdatePackPurchaseMutation } from '../api'

interface PackEditDialogProps {
  open: boolean
  onClose: () => void
  entryUuid: string
  currentValidFrom: string
}

export function PackEditDialog({ open, onClose, entryUuid, currentValidFrom }: PackEditDialogProps) {
  const { t } = useTranslation(['banque', 'common'])
  const [validFrom, setValidFrom] = useState(currentValidFrom || new Date().toISOString().slice(0, 10))
  const updateMutation = useUpdatePackPurchaseMutation()

  if (!open) return null

  async function handleSave() {
    if (!validFrom) return
    await updateMutation.mutateAsync({ entryUuid, valid_from: validFrom })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900">
          {t('ops.packs.editTitle', "Modifier la date d'activation")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t('ops.packs.editDescription', "Modifier la date d'activation du forfait (les vols avant cette date ne seront pas remisés).")}
        </p>

        <div className="mt-4 space-y-1">
          <Label>{t('ops.packs.activationDate', "Date d'activation")}</Label>
          <input
            type="date"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={updateMutation.isPending}>
            {t('common.cancel', 'Annuler')}
          </Button>
          <Button onClick={handleSave} disabled={!validFrom || updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t('common.save', 'Enregistrer')}
          </Button>
        </div>
      </div>
    </div>
  )
}
