/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Fiscal year management page (create, close, reopen)
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
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useCapability } from '../../../auth/hooks/useCapability'
import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  useCloseFiscalYearMutation,
  useCreateFiscalYearMutation,
  useFiscalYearsQuery,
  useReopenFiscalYearMutation,
} from '../api'

type FiscalYearFormState = {
  code: string
  label: string
  year: string
  start_date: string
  end_date: string
}

function defaultFormState(): FiscalYearFormState {
  const nextYear = new Date().getUTCFullYear() + 1
  return {
    code: `FY${nextYear}`,
    label: `Exercice ${nextYear}`,
    year: String(nextYear),
    start_date: `${nextYear}-01-01`,
    end_date: `${nextYear}-12-31`,
  }
}

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

function stateBadgeClass(state: number): string {
  if (state === 1) return 'bg-emerald-100 text-emerald-700'
  if (state === 3) return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

function stateLabel(state: number, t: (key: string) => string): string {
  if (state === 1) return t('fiscalYears.state.open')
  if (state === 2) return t('fiscalYears.state.closed')
  return t('fiscalYears.state.reopened')
}

export function BanqueFiscalYearsPage() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const canManage = useCapability('MANAGE_ACCOUNTING_SETTINGS')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const createMutation = useCreateFiscalYearMutation()
  const closeMutation = useCloseFiscalYearMutation()
  const reopenMutation = useReopenFiscalYearMutation()

  const [form, setForm] = useState<FiscalYearFormState>(() => defaultFormState())

  const sortedFiscalYears = useMemo(
    () => [...(fiscalYearsQuery.data ?? [])].sort((a, b) => b.year - a.year),
    [fiscalYearsQuery.data],
  )

  const isBusy =
    createMutation.isPending || closeMutation.isPending || reopenMutation.isPending

  const combinedError =
    fiscalYearsQuery.error ?? createMutation.error ?? closeMutation.error ?? reopenMutation.error

  async function handleCreateFiscalYear(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    await createMutation.mutateAsync({
      code: form.code.trim(),
      label: form.label.trim(),
      year: Number(form.year),
      start_date: form.start_date,
      end_date: form.end_date,
    })

    setForm(defaultFormState())
  }

  async function handleCloseFiscalYear(fiscalYearUuid: string) {
    await closeMutation.mutateAsync(fiscalYearUuid)
  }

  async function handleReopenFiscalYear(fiscalYearUuid: string) {
    await reopenMutation.mutateAsync(fiscalYearUuid)
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('settings.noPermission')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2">
          <Link to="/banque" className="text-xs text-slate-400 hover:text-slate-600">
            ← {t('journal.back')}
          </Link>
        </div>
        <h1 className="text-xl font-semibold text-slate-900">{t('fiscalYears.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('fiscalYears.description')}</p>
      </div>

      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">{t('fiscalYears.createTitle')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('fiscalYears.createDescription')}</p>

          {!canManage ? <Alert className="mt-4">{t('settings.noPermission')}</Alert> : null}

          {canManage ? (
            <form className="mt-4 space-y-3" onSubmit={(event) => { void handleCreateFiscalYear(event) }}>
              <div className="space-y-1">
                <Label htmlFor="fy-code">{t('fiscalYears.fields.code')}</Label>
                <Input
                  id="fy-code"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fy-label">{t('fiscalYears.fields.label')}</Label>
                <Input
                  id="fy-label"
                  value={form.label}
                  onChange={(event) => setForm({ ...form, label: event.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fy-year">{t('fiscalYears.fields.year')}</Label>
                <Input
                  id="fy-year"
                  type="number"
                  min={2000}
                  max={9999}
                  value={form.year}
                  onChange={(event) => setForm({ ...form, year: event.target.value })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="fy-start">{t('fiscalYears.fields.startDate')}</Label>
                  <Input
                    id="fy-start"
                    type="date"
                    value={form.start_date}
                    onChange={(event) => setForm({ ...form, start_date: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fy-end">{t('fiscalYears.fields.endDate')}</Label>
                  <Input
                    id="fy-end"
                    type="date"
                    value={form.end_date}
                    onChange={(event) => setForm({ ...form, end_date: event.target.value })}
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={
                  isBusy ||
                  form.code.trim() === '' ||
                  form.label.trim() === '' ||
                  form.year.trim() === '' ||
                  form.start_date === '' ||
                  form.end_date === ''
                }
              >
                {createMutation.isPending ? t('fiscalYears.actions.creating') : t('fiscalYears.actions.create')}
              </Button>
            </form>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">{t('fiscalYears.listTitle')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('fiscalYears.listDescription')}</p>

          {fiscalYearsQuery.isLoading ? (
            <p className="mt-4 text-sm text-slate-500">{t('settings.loading')}</p>
          ) : sortedFiscalYears.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">{t('fiscalYears.empty')}</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('fiscalYears.columns.code')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('fiscalYears.columns.label')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('fiscalYears.columns.period')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('fiscalYears.columns.state')}</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">{t('fiscalYears.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedFiscalYears.map((fiscalYear) => (
                    <tr key={fiscalYear.uuid}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{fiscalYear.code}</td>
                      <td className="px-3 py-2 text-slate-800">{fiscalYear.label}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {fiscalYear.start_date} → {fiscalYear.end_date}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateBadgeClass(fiscalYear.state)}`}>
                          {stateLabel(fiscalYear.state, t)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canPost ? (
                          fiscalYear.state === 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => { void handleCloseFiscalYear(fiscalYear.uuid) }}
                            >
                              {closeMutation.isPending ? t('fiscalYears.actions.closing') : t('fiscalYears.actions.close')}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => { void handleReopenFiscalYear(fiscalYear.uuid) }}
                            >
                              {reopenMutation.isPending ? t('fiscalYears.actions.reopening') : t('fiscalYears.actions.reopen')}
                            </Button>
                          )
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
