/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Cheque settings form — pending cheques account + bank account
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
import { Label } from '../../../components/ui/label'
import { SearchableSelect } from '../../../components/ui/searchable-select'
import {
  useAccountsQuery,
  useBanqueModuleSettingsQuery,
  useUpsertBanqueModuleSettingsMutation,
} from '../api'
import { toErrorMessage } from './journalShared'

export function ChequeSettingsForm() {
  const { t } = useTranslation('banque')

  const { data: settings, isLoading, error: loadError } = useBanqueModuleSettingsQuery('cheque_payments', true)
  const { data: accounts } = useAccountsQuery(true)
  const upsertMutation = useUpsertBanqueModuleSettingsMutation('cheque_payments')

  const [pendingAccount, setPendingAccount] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings) return
    setPendingAccount(typeof settings.settings.pending_account_uuid === 'string' ? settings.settings.pending_account_uuid : '')
    setBankAccount(typeof settings.settings.bank_account_uuid === 'string' ? settings.settings.bank_account_uuid : '')
  }, [settings])

  const accountOptions = (accounts ?? []).map((a) => ({ value: a.uuid, label: `${a.code} · ${a.name}` }))

  async function handleSave() {
    setSaved(false)
    await upsertMutation.mutateAsync({
      settings: {
        pending_account_uuid: pendingAccount || null,
        bank_account_uuid: bankAccount || null,
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
          <Label className="text-xs font-medium">{t('cheque.pendingAccount')}</Label>
          <SearchableSelect
            options={accountOptions}
            value={pendingAccount}
            onChange={setPendingAccount}
            placeholder={t('cheque.selectAccount')}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">{t('cheque.bankAccount')}</Label>
          <SearchableSelect
            options={accountOptions}
            value={bankAccount}
            onChange={setBankAccount}
            placeholder={t('cheque.selectAccount')}
          />
        </div>
      </div>

      <Button type="button" onClick={() => void handleSave()} disabled={upsertMutation.isPending}>
        {upsertMutation.isPending ? t('settings.saving') : t('settings.save')}
      </Button>
    </div>
  )
}
