/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Credit card (CB) settlement settings form — bank/fees accounts + commission rate
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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import {
  useAccountsQuery,
  useBanqueModuleSettingsQuery,
  useUpsertBanqueModuleSettingsMutation,
} from '../api'
import { toErrorMessage } from './journalShared'

export function CreditCardSettingsForm() {
  const { t } = useTranslation('banque')

  const { data: settings, isLoading, error: loadError } = useBanqueModuleSettingsQuery('credit_card_payments', true)
  const { data: accounts } = useAccountsQuery(true)
  const upsertMutation = useUpsertBanqueModuleSettingsMutation('credit_card_payments')

  const [bankAccount, setBankAccount] = useState('')
  const [feesAccount, setFeesAccount] = useState('')
  const [feePercentage, setFeePercentage] = useState('0.5')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings) return
    setBankAccount(typeof settings.settings.bank_account_uuid === 'string' ? settings.settings.bank_account_uuid : '')
    setFeesAccount(typeof settings.settings.fees_account_uuid === 'string' ? settings.settings.fees_account_uuid : '')
    setFeePercentage(
      typeof settings.settings.fee_percentage === 'string' || typeof settings.settings.fee_percentage === 'number'
        ? String(settings.settings.fee_percentage)
        : '0.5',
    )
  }, [settings])

  const accountOptions = (accounts ?? []).map((a) => ({ value: a.uuid, label: `${a.code} · ${a.name}` }))

  async function handleSave() {
    setSaved(false)
    await upsertMutation.mutateAsync({
      settings: {
        bank_account_uuid: bankAccount || null,
        fees_account_uuid: feesAccount || null,
        fee_percentage: feePercentage,
      },
    })
    setSaved(true)
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('settings.loading')}</p>
  }

  return (
    <div className="space-y-4">
      {loadError && <Alert>{toErrorMessage(loadError, t('journal.errors.generic'))}</Alert>}
      {upsertMutation.error && <Alert>{toErrorMessage(upsertMutation.error, t('journal.errors.generic'))}</Alert>}
      {saved && <Alert><p className="text-sm text-success">{t('settings.saved', 'Paramètres enregistrés')}</p></Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs font-medium">{t('creditCard.bankAccount')}</Label>
          <SearchableSelect
            options={accountOptions}
            value={bankAccount}
            onChange={setBankAccount}
            placeholder={t('creditCard.selectAccount')}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">{t('creditCard.feesAccount')}</Label>
          <SearchableSelect
            options={accountOptions}
            value={feesAccount}
            onChange={setFeesAccount}
            placeholder={t('creditCard.selectAccount')}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">{t('creditCard.feePercentage')}</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={feePercentage}
            onChange={(event) => setFeePercentage(event.target.value)}
          />
        </div>
      </div>

      <Button type="button" onClick={() => void handleSave()} disabled={upsertMutation.isPending}>
        {upsertMutation.isPending ? t('settings.saving') : t('settings.save')}
      </Button>
    </div>
  )
}
