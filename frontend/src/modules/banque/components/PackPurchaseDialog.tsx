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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import { useMemberOptionsQuery } from '../../members/api'
import { usePackDefinitionsQuery, useBuyPackMutation } from '../api'

interface PackPurchaseDialogProps {
  open: boolean
  onClose: () => void
}

export function PackPurchaseDialog({ open, onClose }: PackPurchaseDialogProps) {
  const { t } = useTranslation(['banque', 'common'])
  const { data: memberOptions } = useMemberOptionsQuery()
  const { data: packDefs } = usePackDefinitionsQuery()
  const buyPackMutation = useBuyPackMutation()

  const [memberUuid, setMemberUuid] = useState('')
  const [packDefUuid, setPackDefUuid] = useState('')
  const [price, setPrice] = useState('')
  const [validFrom, setValidFrom] = useState('')

  if (!open) return null

  async function handleBuy() {
    if (!memberUuid || !packDefUuid || !price) return
    await buyPackMutation.mutateAsync({
      memberUuid,
      packDefinitionUuid: packDefUuid,
      price,
      valid_from: validFrom || new Date().toISOString().slice(0, 10),
    })
    onClose()
    setMemberUuid('')
    setPackDefUuid('')
    setPrice('')
    setValidFrom('')
  }

  const memberOptionsForSelect = (memberOptions ?? []).map((m: { uuid: string; account_id: string; first_name: string; last_name: string }) => ({
    value: m.uuid,
    label: `${m.account_id} — ${m.first_name} ${m.last_name}`,
  }))

  const packOptions = (packDefs ?? []).map((p: { uuid: string; code: string; name: string; quantity_allowance: string; pack_type: string }) => ({
    value: p.uuid,
    label: `${p.code} — ${p.name} (${p.quantity_allowance} × ${p.pack_type})`,
  }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900">{t('ops.packs.sell', 'Vendre un forfait')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('ops.packs.sellDescription', 'Sélectionnez membre, forfait, prix et date d\'activation.')}</p>

        <div className="mt-4 space-y-4">
          <div className="space-y-1">
            <Label>{t('ops.packs.member', 'Membre')}</Label>
            <SearchableSelect
              options={memberOptionsForSelect}
              value={memberUuid}
              onChange={setMemberUuid}
              placeholder={t('ops.packs.selectMember', 'Sélectionner un membre…')}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('ops.packs.pack', 'Forfait')}</Label>
            <SearchableSelect
              options={packOptions}
              value={packDefUuid}
              onChange={setPackDefUuid}
              placeholder={t('ops.packs.selectPack', 'Sélectionner un forfait…')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('ops.packs.price', 'Prix de vente (EUR)')}</Label>
              <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('ops.packs.activationDate', 'Date d\'activation')}</Label>
              <input
                type="date"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={buyPackMutation.isPending}>
            {t('common.cancel', 'Annuler')}
          </Button>
          <Button onClick={handleBuy} disabled={!memberUuid || !packDefUuid || !price || buyPackMutation.isPending}>
            {buyPackMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t('ops.packs.buy', 'Vendre')}
          </Button>
        </div>
      </div>
    </div>
  )
}
