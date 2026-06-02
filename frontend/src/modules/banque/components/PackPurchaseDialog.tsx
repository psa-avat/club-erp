/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Pack purchase dialog — buy a pack for a member
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
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { Dialog } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { usePackDefinitionsQuery } from '../api'
import type { MemberOption } from '../../members/types'

type Props = {
  open: boolean
  members: MemberOption[]
  onClose: () => void
  onConfirm: (memberUuid: string, packDefinitionUuid: string, quantity: number) => Promise<void>
  isSubmitting: boolean
}

export function PackPurchaseDialog({ open, members, onClose, onConfirm, isSubmitting }: Props) {
  const { t } = useTranslation(['banque', 'common'])
  const [selectedMemberUuid, setSelectedMemberUuid] = useState('')
  const [selectedPackUuid, setSelectedPackUuid] = useState('')
  const [quantity, setQuantity] = useState(1)

  const { data: packDefinitions = [] } = usePackDefinitionsQuery(undefined, undefined, open)

  useEffect(() => {
    if (open) {
      setSelectedMemberUuid('')
      setSelectedPackUuid('')
      setQuantity(1)
    }
  }, [open])

  const selectedPack = packDefinitions.find((p) => p.uuid === selectedPackUuid)
  const canSubmit = selectedMemberUuid && selectedPackUuid && quantity > 0

  const handleConfirm = async () => {
    if (!canSubmit || isSubmitting) return
    await onConfirm(selectedMemberUuid, selectedPackUuid, quantity)
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">{t('packs.purchase.title')}</h2>

        <div className="space-y-2">
          <Label htmlFor="member">{t('packs.purchase.member')}</Label>
          <select
            id="member"
            value={selectedMemberUuid}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedMemberUuid(e.target.value)}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="" disabled>{t('packs.purchase.selectMember')}</option>
            {members.map((m) => (
              <option key={m.uuid} value={m.uuid}>
                {`${m.first_name} ${m.last_name}`} ({m.account_id})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pack">{t('packs.purchase.pack')}</Label>
          <select
            id="pack"
            value={selectedPackUuid}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedPackUuid(e.target.value)}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="" disabled>{t('packs.purchase.selectPack')}</option>
            {packDefinitions.map((p) => (
              <option key={p.uuid} value={p.uuid}>
                {p.code} — {p.name} ({p.quantity_allowance} {p.quantity_unit})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quantity">{t('packs.purchase.quantity')}</Label>
          <Input
            id="quantity"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
          />
        </div>

        {selectedPack && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p><strong>{selectedPack.code}</strong> — {selectedPack.name}</p>
            <p className="mt-1 text-xs text-slate-500">
              {t('packs.purchase.type')}: {selectedPack.pack_type} &middot;{' '}
              {t('packs.purchase.allowance')}: {selectedPack.quantity_allowance} {selectedPack.quantity_unit}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? t('common.loading') : t('packs.purchase.buy')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
