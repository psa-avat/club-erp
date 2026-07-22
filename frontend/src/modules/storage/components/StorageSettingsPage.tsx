import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  storageSettingsFromResponse,
  useStorageConnectionTestMutation,
  useStorageSettingsQuery,
  useUpdateStorageSettingsMutation,
  type StorageSettings,
} from '../api'

const MASKED = '***'

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: string } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'string' && detail.length > 0) return detail
    if (typeof response?.data?.message === 'string' && response.data.message.length > 0) return response.data.message
    if (detail && typeof detail === 'object' && 'message' in detail) {
      const message = (detail as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) return message
    }
  }
  return 'Unexpected error'
}

const EMPTY_SETTINGS: StorageSettings = {
  endpoint: '',
  access_key: '',
  secret_key: '',
  bucket_name: '',
  region: 'us-east-1',
  use_ssl: true,
  presigned_url_expiry_seconds: 3600,
}

export function StorageSettingsPage() {
  const { t } = useTranslation('storage')

  const settingsQuery = useStorageSettingsQuery(true)
  const updateMutation = useUpdateStorageSettingsMutation()
  const connectionTestMutation = useStorageConnectionTestMutation()

  const [formState, setFormState] = useState<StorageSettings>(EMPTY_SETTINGS)
  const [connectionResult, setConnectionResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!settingsQuery.data) return
    setFormState(storageSettingsFromResponse(settingsQuery.data))
  }, [settingsQuery.data])

  const currentStatus = useMemo(() => {
    if (connectionTestMutation.isSuccess) {
      const data = connectionTestMutation.data
      if (data?.success) return { tone: 'success', label: t('status.connected') }
      return { tone: 'error', label: t('status.disconnected') }
    }
    if (connectionTestMutation.isError) return { tone: 'error', label: t('status.disconnected') }
    return { tone: 'neutral', label: t('status.unknown') }
  }, [connectionTestMutation.isSuccess, connectionTestMutation.isError, connectionTestMutation.data, t])

  function updateField<K extends keyof StorageSettings>(key: K, value: StorageSettings[K]) {
    setFormState((current) => ({ ...current, [key]: value }))
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Replace empty secret fields with the masked sentinel so the backend keeps the existing value
    const payload: StorageSettings = {
      ...formState,
      access_key: formState.access_key === '' ? MASKED : formState.access_key,
      secret_key: formState.secret_key === '' ? MASKED : formState.secret_key,
    }
    await updateMutation.mutateAsync(payload)
  }

  async function handleConnectionTest() {
    setConnectionResult(null)
    try {
      const result = await connectionTestMutation.mutateAsync({
        ...formState,
        access_key: formState.access_key === '' ? MASKED : formState.access_key,
        secret_key: formState.secret_key === '' ? MASKED : formState.secret_key,
      })
      setConnectionResult({ success: result.success, message: result.message })
    } catch {
      setConnectionResult(null)
    }
  }

  const isBusy = settingsQuery.isLoading || updateMutation.isPending || connectionTestMutation.isPending
  const errorMessage = settingsQuery.error ?? updateMutation.error ?? connectionTestMutation.error

  return (
    <section className="space-y-4">
      <form
        className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
        onSubmit={(event) => { void handleSave(event) }}
      >
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
          <Field label={t('fields.endpoint')} htmlFor="storage-endpoint">
            <Input
              id="storage-endpoint"
              value={formState.endpoint}
              placeholder="http://localhost:9000"
              onChange={(event) => updateField('endpoint', event.target.value)}
            />
          </Field>
          <Field label={t('fields.bucketName')} htmlFor="storage-bucket">
            <Input
              id="storage-bucket"
              value={formState.bucket_name}
              placeholder="club-erp"
              onChange={(event) => updateField('bucket_name', event.target.value)}
            />
          </Field>
          <Field label={t('fields.accessKey')} htmlFor="storage-access-key">
            <Input
              id="storage-access-key"
              value={formState.access_key}
              placeholder={t('fields.secretPlaceholder')}
              onChange={(event) => updateField('access_key', event.target.value)}
            />
          </Field>
          <Field label={t('fields.secretKey')} htmlFor="storage-secret-key">
            <Input
              id="storage-secret-key"
              type="password"
              value={formState.secret_key}
              placeholder={t('fields.secretPlaceholder')}
              onChange={(event) => updateField('secret_key', event.target.value)}
            />
          </Field>
          <Field label={t('fields.region')} htmlFor="storage-region">
            <Input
              id="storage-region"
              value={formState.region}
              placeholder="us-east-1"
              onChange={(event) => updateField('region', event.target.value)}
            />
          </Field>
          <Field label={t('fields.presignedExpiry')} htmlFor="storage-expiry">
            <Input
              id="storage-expiry"
              type="number"
              min={60}
              max={604800}
              value={formState.presigned_url_expiry_seconds}
              onChange={(event) => updateField('presigned_url_expiry_seconds', Number(event.target.value))}
            />
          </Field>
          <div className="flex items-center gap-3 md:col-span-2">
            <input
              id="storage-use-ssl"
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              checked={formState.use_ssl}
              onChange={(event) => updateField('use_ssl', event.target.checked)}
            />
            <Label htmlFor="storage-use-ssl">{t('fields.useSsl')}</Label>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button disabled={isBusy} type="submit">
            {updateMutation.isPending ? t('actions.saving') : t('actions.save')}
          </Button>
          <Button disabled={isBusy} type="button" variant="secondary" onClick={() => { void handleConnectionTest() }}>
            {connectionTestMutation.isPending ? t('actions.testingConnection') : t('actions.testConnection')}
          </Button>
        </div>

        {settingsQuery.isLoading ? <p className="text-sm text-slate-600">{t('state.loading')}</p> : null}
        {errorMessage ? <Alert>{toErrorMessage(errorMessage)}</Alert> : null}
        {connectionResult ? (
          <Alert variant={connectionResult.success ? 'success' : 'error'}>{connectionResult.message}</Alert>
        ) : null}
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
