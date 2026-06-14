import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  plancheSettingsFromResponse,
  usePlancheConnectionTestMutation,
  usePlancheLoginTestMutation,
  usePlancheSettingsQuery,
  useUpdatePlancheSettingsMutation,
  type PlancheSettings,
} from '../api'

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: string } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }

    if (typeof response?.data?.message === 'string' && response.data.message.length > 0) {
      return response.data.message
    }

    if (detail && typeof detail === 'object' && 'message' in detail) {
      const message = (detail as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) {
        return message
      }
    }
  }

  return 'Unexpected error'
}

const EMPTY_SETTINGS: PlancheSettings = {
  base_url: '',
  connection_id: '',
  token: '',
  user: '',
  password: '',
  environment: 'test',
  chunk_size: 10,
}

export function PlancheIntegrationPage() {
  const { t } = useTranslation('planche')

  const settingsQuery = usePlancheSettingsQuery(true)
  const updateMutation = useUpdatePlancheSettingsMutation()
  const connectionTestMutation = usePlancheConnectionTestMutation()
  const loginTestMutation = usePlancheLoginTestMutation()

  const [formState, setFormState] = useState<PlancheSettings>(EMPTY_SETTINGS)
  const [connectionResult, setConnectionResult] = useState<string | null>(null)
  const [loginResult, setLoginResult] = useState<string | null>(null)

  useEffect(() => {
    if (!settingsQuery.data) {
      return
    }

    setFormState(plancheSettingsFromResponse(settingsQuery.data))
  }, [settingsQuery.data])

  const currentStatus = useMemo(() => {
    if (connectionTestMutation.isSuccess) {
      return { tone: 'success', label: t('status.connected') }
    }

    if (connectionTestMutation.isError) {
      return { tone: 'error', label: t('status.disconnected') }
    }

    return { tone: 'neutral', label: t('status.unknown') }
  }, [connectionTestMutation.isError, connectionTestMutation.isSuccess, t])

  function updateField<K extends keyof PlancheSettings>(key: K, value: PlancheSettings[K]) {
    setFormState((current) => ({ ...current, [key]: value }))
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await updateMutation.mutateAsync(formState)
  }

  async function handleConnectionTest() {
    setConnectionResult(null)
    try {
      const result = await connectionTestMutation.mutateAsync(formState)
      setConnectionResult(result.message)
    } catch {
      setConnectionResult(null)
    }
  }

  async function handleLoginTest() {
    setLoginResult(null)
    try {
      const result = await loginTestMutation.mutateAsync(formState)
      setLoginResult(result.message)
    } catch {
      setLoginResult(null)
    }
  }

  const isBusy =
    settingsQuery.isLoading ||
    updateMutation.isPending ||
    connectionTestMutation.isPending ||
    loginTestMutation.isPending

  const errorMessage = settingsQuery.error ?? updateMutation.error ?? connectionTestMutation.error ?? loginTestMutation.error

  return (
    <section className="space-y-4">
      <form className="space-y-4 rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm" onSubmit={(event) => { void handleSave(event) }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{t('form.title')}</h2>
            <p className="text-sm text-slate-600">{t('form.description')}</p>
          </div>
          <div
            className={[
              'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold',
              currentStatus.tone === 'success'
                ? 'bg-green-50 text-green-900'
                : currentStatus.tone === 'error'
                  ? 'bg-red-50 text-red-900'
                  : 'bg-slate-100 text-slate-700',
            ].join(' ')}
          >
            {currentStatus.label}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('fields.baseUrl')} htmlFor="planche-base-url">
            <Input id="planche-base-url" required value={formState.base_url} onChange={(event) => updateField('base_url', event.target.value)} />
          </Field>
          <Field label={t('fields.connectionId')} htmlFor="planche-connection-id">
            <Input id="planche-connection-id" required value={formState.connection_id} onChange={(event) => updateField('connection_id', event.target.value)} />
          </Field>
          <Field label={t('fields.token')} htmlFor="planche-token">
            <Input id="planche-token" required type="password" value={formState.token} onChange={(event) => updateField('token', event.target.value)} />
          </Field>
          <Field label={t('fields.environment')} htmlFor="planche-environment">
            <select
              id="planche-environment"
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
              value={formState.environment}
              onChange={(event) => updateField('environment', event.target.value)}
            >
              <option value="test">{t('fields.environments.test')}</option>
              <option value="production">{t('fields.environments.production')}</option>
            </select>
          </Field>
          <Field label={t('fields.user')} htmlFor="planche-user">
            <Input id="planche-user" required value={formState.user} onChange={(event) => updateField('user', event.target.value)} />
          </Field>
          <Field label={t('fields.password')} htmlFor="planche-password">
            <Input id="planche-password" required type="password" value={formState.password} onChange={(event) => updateField('password', event.target.value)} />
          </Field>
          <Field label={t('fields.chunkSize')} htmlFor="planche-chunk-size">
            <Input id="planche-chunk-size" type="number" min={1} max={100} value={formState.chunk_size ?? 10} onChange={(event) => updateField('chunk_size', parseInt(event.target.value, 10) || 10)} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button disabled={isBusy} type="submit">
            {updateMutation.isPending ? t('actions.saving') : t('actions.save')}
          </Button>
          <Button disabled={isBusy} type="button" variant="secondary" onClick={() => { void handleConnectionTest() }}>
            {connectionTestMutation.isPending ? t('actions.testingConnection') : t('actions.testConnection')}
          </Button>
          <Button disabled={isBusy} type="button" variant="secondary" onClick={() => { void handleLoginTest() }}>
            {loginTestMutation.isPending ? t('actions.testingLogin') : t('actions.testLogin')}
          </Button>
        </div>

        {settingsQuery.isLoading ? <p className="text-sm text-slate-600">{t('state.loading')}</p> : null}
        {errorMessage ? <Alert>{toErrorMessage(errorMessage)}</Alert> : null}
        {connectionResult ? <Alert variant="success">{connectionResult}</Alert> : null}
        {loginResult ? <Alert variant="success">{loginResult}</Alert> : null}
      </form>
    </section>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
