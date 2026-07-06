import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'

import { useCapability } from '../../../auth/hooks'
import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Label } from '../../../components/ui/label'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import {
  useBanqueModuleSettingsQuery,
  useFiscalYearsQuery,
  useUpsertBanqueModuleSettingsMutation,
} from '../api'
import { FlightBillingSettingsForm } from './FlightBillingSettingsForm'
import { CreditCardSettingsForm } from './CreditCardSettingsForm'
import { ChequeSettingsForm } from './ChequeSettingsForm'

type SettingsSection = {
  moduleName: string
  titleKey: string
  descriptionKey: string
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    moduleName: 'accounting',
    titleKey: 'settings.sections.accounting.title',
    descriptionKey: 'settings.sections.accounting.description',
  },
  {
    moduleName: 'flight_billing',
    titleKey: 'settings.sections.flightBilling.title',
    descriptionKey: 'settings.sections.flightBilling.description',
  },
  {
    moduleName: 'pricing',
    titleKey: 'settings.sections.pricing.title',
    descriptionKey: 'settings.sections.pricing.description',
  },
  {
    moduleName: 'budget',
    titleKey: 'settings.sections.budget.title',
    descriptionKey: 'settings.sections.budget.description',
  },
  {
    moduleName: 'integrations',
    titleKey: 'settings.sections.integrations.title',
    descriptionKey: 'settings.sections.integrations.description',
  },
  {
    moduleName: 'credit_card_payments',
    titleKey: 'settings.sections.creditCard.title',
    descriptionKey: 'settings.sections.creditCard.description',
  },
  {
    moduleName: 'cheque_payments',
    titleKey: 'settings.sections.cheque.title',
    descriptionKey: 'settings.sections.cheque.description',
  },
]

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: string } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }

    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string }
      if (typeof first?.msg === 'string' && first.msg.length > 0) {
        return first.msg
      }
    }

    if (typeof response?.data?.message === 'string' && response.data.message.length > 0) {
      return response.data.message
    }
  }

  return 'Unexpected error'
}

export function BanqueSettingsPage() {
  const { t } = useTranslation('banque')
  const canManageSettings = useCapability('MANAGE_SYSTEM_SETTINGS')
  const [searchParams, setSearchParams] = useSearchParams()
  const sectionParam = searchParams.get('section')
  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  const { data: fiscalYears } = useFiscalYearsQuery(true)
  const selectedFy = fiscalYears?.find((fy) => fy.uuid === activeFiscalYearUuid)

  const activeSection = useMemo(
    () => SETTINGS_SECTIONS.find((section) => section.moduleName === sectionParam) ?? SETTINGS_SECTIONS[0],
    [sectionParam],
  )

  function selectSection(moduleName: string) {
    setSearchParams((prev: URLSearchParams) => {
      const next = new URLSearchParams(prev)
      next.set('section', moduleName)
      return next
    }, { replace: true })
  }

  const moduleSettingsQuery = useBanqueModuleSettingsQuery(activeSection.moduleName, canManageSettings)
  const upsertMutation = useUpsertBanqueModuleSettingsMutation(activeSection.moduleName)

  const [jsonDraft, setJsonDraft] = useState('{}')

  const queryError = moduleSettingsQuery.error
  const mutationError = upsertMutation.error
  const settingsError = queryError ?? mutationError

  useEffect(() => {
    if (!moduleSettingsQuery.data) return
    setJsonDraft(JSON.stringify(moduleSettingsQuery.data.settings, null, 2))
  }, [moduleSettingsQuery.data])

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonDraft) as Record<string, unknown>
    } catch {
      return
    }
    await upsertMutation.mutateAsync({ settings: parsed })
  }

  const invalidJson = useMemo(() => {
    try {
      JSON.parse(jsonDraft)
      return false
    } catch {
      return true
    }
  }, [jsonDraft])

  const isFlightBilling = activeSection.moduleName === 'flight_billing'
  const isCreditCardPayments = activeSection.moduleName === 'credit_card_payments'
  const isChequePayments = activeSection.moduleName === 'cheque_payments'

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">{t('settings.title')}</h2>
          <p className="text-sm text-slate-600">{t('settings.description')}</p>
        </header>

        {!canManageSettings ? <Alert className="mt-4">{t('settings.noPermission')}</Alert> : null}

        {canManageSettings ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
            <aside className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="space-y-1">
                {SETTINGS_SECTIONS.map((section) => (
                  <button
                    key={section.moduleName}
                    type="button"
                    className={[
                      'block w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                      activeSection.moduleName === section.moduleName
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-200',
                    ].join(' ')}
                    onClick={() => selectSection(section.moduleName)}
                  >
                    {t(section.titleKey)}
                  </button>
                ))}
              </div>
            </aside>

            {isFlightBilling ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{t(activeSection.titleKey)}</h3>
                  <p className="text-sm text-slate-600">{t(activeSection.descriptionKey)}</p>
                </div>
                {selectedFy ? (
                  <FlightBillingSettingsForm fiscalYearUuid={selectedFy.uuid} />
                ) : (
                  <Alert>
                    <p className="text-sm text-slate-600">
                      {t('settings.flightBilling.noFiscalYear', 'Aucun exercice fiscal actif. Sélectionnez un exercice dans le module Banque.')}
                    </p>
                  </Alert>
                )}
              </div>
            ) : isCreditCardPayments ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{t(activeSection.titleKey)}</h3>
                  <p className="text-sm text-slate-600">{t(activeSection.descriptionKey)}</p>
                </div>
                <CreditCardSettingsForm />
              </div>
            ) : isChequePayments ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{t(activeSection.titleKey)}</h3>
                  <p className="text-sm text-slate-600">{t(activeSection.descriptionKey)}</p>
                </div>
                <ChequeSettingsForm />
              </div>
            ) : (
              <form className="space-y-3" onSubmit={(event) => { void handleSave(event) }}>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{t(activeSection.titleKey)}</h3>
                  <p className="text-sm text-slate-600">{t(activeSection.descriptionKey)}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="settings-json">{t('settings.jsonLabel')}</Label>
                  <textarea
                    id="settings-json"
                    className="min-h-72 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    value={jsonDraft}
                    onChange={(event) => setJsonDraft(event.target.value)}
                  />
                </div>

                {invalidJson ? <Alert>{t('settings.invalidJson')}</Alert> : null}
                {settingsError ? <Alert>{toErrorMessage(settingsError)}</Alert> : null}

                <div className="flex items-center gap-3">
                  <Button disabled={moduleSettingsQuery.isLoading || upsertMutation.isPending || invalidJson} type="submit">
                    {upsertMutation.isPending ? t('settings.saving') : t('settings.save')}
                  </Button>
                  {moduleSettingsQuery.isLoading ? (
                    <span className="text-sm text-slate-600">{t('settings.loading')}</span>
                  ) : null}
                </div>
              </form>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
