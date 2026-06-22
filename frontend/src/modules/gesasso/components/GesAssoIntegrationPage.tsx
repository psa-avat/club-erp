/*
    ERP-CLUB - ERP pour Club de vol à voile
    - gesasso: Configuration page for GesAsso (FFVP) integration credentials
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
import { CheckCircle2, XCircle } from 'lucide-react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useGesAssoSettingsQuery,
  useUpdateGesAssoSettingsMutation,
  useGesAssoPilotLookupMutation,
  type GesAssoSettings,
} from '../api'

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    const detail = response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
  }
  return 'Unexpected error'
}

const EMPTY_SETTINGS: GesAssoSettings = {
  base_url: 'https://api.gesasso.ffvp.fr',
  username: '',
  secret: '',
}

export function GesAssoIntegrationPage() {
  const { t } = useTranslation('admin')

  const settingsQuery = useGesAssoSettingsQuery(true)
  const updateMutation = useUpdateGesAssoSettingsMutation()
  const pilotLookupMutation = useGesAssoPilotLookupMutation()

  const [formState, setFormState] = useState<GesAssoSettings>(EMPTY_SETTINGS)
  const [testFfvpId, setTestFfvpId] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    const s = settingsQuery.data?.settings
    if (s) {
      setFormState({ base_url: s.base_url || EMPTY_SETTINGS.base_url, username: s.username || '', secret: s.secret || '' })
    }
  }, [settingsQuery.data])

  function updateField<K extends keyof GesAssoSettings>(key: K, value: GesAssoSettings[K]) {
    setFormState((current) => ({ ...current, [key]: value }))
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await updateMutation.mutateAsync(formState)
  }

  async function handleTestConnection() {
    const ffvpId = parseInt(testFfvpId, 10)
    if (!ffvpId || ffvpId <= 0) return
    setTestResult(null)
    try {
      const result = await pilotLookupMutation.mutateAsync(ffvpId)
      const name = [result.personal_info?.first_name, result.personal_info?.last_name].filter(Boolean).join(' ')
      setTestResult({ ok: true, message: t('gesasso.testSuccess', { name: name || `FFVP#${ffvpId}` }) })
    } catch (err) {
      setTestResult({ ok: false, message: toErrorMessage(err) })
    }
  }

  const updatedAt = settingsQuery.data?.updated_at
    ? new Date(settingsQuery.data.updated_at).toLocaleString('fr-FR')
    : null

  return (
    <div className="space-y-6 max-w-2xl">
      {settingsQuery.error ? <Alert>{toErrorMessage(settingsQuery.error)}</Alert> : null}
      {updateMutation.isSuccess ? (
        <Alert className="border-green-500 text-green-700">{t('gesasso.saveSuccess')}</Alert>
      ) : null}
      {updateMutation.error ? <Alert>{toErrorMessage(updateMutation.error)}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('gesasso.title')}</CardTitle>
          <CardDescription>{t('gesasso.description')}</CardDescription>
          {updatedAt ? (
            <p className="text-xs text-muted-foreground">{t('gesasso.lastUpdated', { date: updatedAt })}</p>
          ) : null}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gesasso-base-url">{t('gesasso.baseUrl')}</Label>
              <Input
                id="gesasso-base-url"
                value={formState.base_url}
                onChange={(e) => updateField('base_url', e.target.value)}
                placeholder="https://api.gesasso.ffvp.fr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gesasso-username">{t('gesasso.username')}</Label>
              <Input
                id="gesasso-username"
                value={formState.username}
                onChange={(e) => updateField('username', e.target.value)}
                placeholder="wsse_avat"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gesasso-secret">{t('gesasso.secret')}</Label>
              <Input
                id="gesasso-secret"
                type="password"
                value={formState.secret}
                onChange={(e) => updateField('secret', e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('gesasso.saving') : t('gesasso.save')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('gesasso.testTitle')}</CardTitle>
          <CardDescription>{t('gesasso.testDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={testFfvpId}
              onChange={(e) => setTestFfvpId(e.target.value)}
              placeholder={t('gesasso.testFfvpIdPlaceholder')}
              type="number"
              className="max-w-40"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={!testFfvpId || pilotLookupMutation.isPending}
            >
              {pilotLookupMutation.isPending ? t('gesasso.testing') : t('gesasso.test')}
            </Button>
          </div>
          {testResult ? (
            <div className={`mt-3 flex items-center gap-2 text-sm ${testResult.ok ? 'text-green-700' : 'text-destructive'}`}>
              {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              <span>{testResult.message}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
