/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - helloasso: Purchases page for HelloAsso items/orders listing
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

import { Alert } from '../../../components/ui/alert'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useHelloAssoPurchasesQuery, type HelloAssoPurchaseSource, type HelloAssoPurchaseStatus } from '../api'

const CAMPAIGN_TYPES = ['CrowdFunding', 'Membership', 'Event', 'Donation', 'PaymentForm', 'Checkout', 'Shop'] as const

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

function formatAmount(cents: number | null): string {
  if (typeof cents !== 'number') {
    return '-'
  }
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function formatDate(value: string | null): string {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function formatCampaignAndSlug(campaignType: string | null, formSlug: string | null): string {
  if (campaignType && formSlug) {
    return `${campaignType} / ${formSlug}`
  }
  return campaignType ?? formSlug ?? '-'
}

export function HelloAssoPurchasesPage() {
  const { t } = useTranslation('helloasso')

  const [status, setStatus] = useState<HelloAssoPurchaseStatus>('active')
  const [source, setSource] = useState<HelloAssoPurchaseSource>('items')
  const [campaignTypes, setCampaignTypes] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const purchasesQuery = useHelloAssoPurchasesQuery(status, source, campaignTypes, true)

  function toggleCampaignType(value: string) {
    setCampaignTypes((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
    )
  }

  function clearCampaignTypes() {
    setCampaignTypes([])
  }

  const rows = purchasesQuery.data?.purchases ?? []
  const normalizedSearch = search.trim().toLowerCase()
  const filteredRows = normalizedSearch.length === 0
    ? rows
    : rows.filter((row) => {
      const values = [
        row.full_name,
        row.first_name,
        row.last_name,
        row.email,
        row.phone,
        row.item_id?.toString(),
        row.order_id?.toString(),
      ]
      return values.some((value) => value?.toLowerCase().includes(normalizedSearch))
    })

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-outline-variant bg-gradient-to-r from-sky-950 via-teal-900 to-emerald-800 p-6 text-white shadow-sm">
        <div className="max-w-3xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-100">{t('purchases.hero.kicker')}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{t('purchases.hero.title')}</h1>
          <p className="max-w-2xl text-sm text-emerald-50/90">{t('purchases.hero.description')}</p>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="helloasso-purchases-status">{t('purchases.filters.status')}</Label>
            <select
              id="helloasso-purchases-status"
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
              value={status}
              onChange={(event) => setStatus(event.target.value as HelloAssoPurchaseStatus)}
            >
              <option value="active">{t('purchases.filters.statusValues.active')}</option>
              <option value="done">{t('purchases.filters.statusValues.done')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="helloasso-purchases-source">{t('purchases.filters.source')}</Label>
            <select
              id="helloasso-purchases-source"
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
              value={source}
              onChange={(event) => setSource(event.target.value as HelloAssoPurchaseSource)}
            >
              <option value="items">{t('purchases.filters.sourceValues.items')}</option>
              <option value="orders">{t('purchases.filters.sourceValues.orders')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="helloasso-purchases-search">{t('purchases.filters.search')}</Label>
            <Input
              id="helloasso-purchases-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('purchases.filters.searchPlaceholder')}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('purchases.filters.campaignType')}</Label>
            <button
              type="button"
              className="text-xs font-semibold text-slate-700 underline underline-offset-2"
              onClick={clearCampaignTypes}
            >
              {t('purchases.filters.campaignTypeValues.all')}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {CAMPAIGN_TYPES.map((value) => (
              <label key={value} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                  checked={campaignTypes.includes(value)}
                  onChange={() => toggleCampaignType(value)}
                />
                {value}
              </label>
            ))}
          </div>
        </div>

        <div className="text-sm text-slate-600">
          {t('purchases.results.count', {
            count: filteredRows.length,
            organization: purchasesQuery.data?.organization_slug ?? '-',
          })}
        </div>

        {purchasesQuery.isLoading ? <p className="text-sm text-slate-600">{t('purchases.state.loading')}</p> : null}
        {purchasesQuery.error ? <Alert>{toErrorMessage(purchasesQuery.error)}</Alert> : null}

        <div className="overflow-x-auto rounded-xl border border-outline-variant">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('purchases.table.id')}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('purchases.table.name')}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('purchases.table.campaignType')}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('purchases.table.email')}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('purchases.table.phone')}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('purchases.table.amount')}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('purchases.table.payments')}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('purchases.table.states')}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">{t('purchases.table.date')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredRows.map((row) => (
                <tr key={`${row.source}-${row.id}-${row.order_id ?? 'na'}`}>
                  <td className="px-3 py-2 text-slate-800">#{row.id}</td>
                  <td className="px-3 py-2 text-slate-800">{row.full_name ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-800">{formatCampaignAndSlug(row.campaign_type, row.form_slug)}</td>
                  <td className="px-3 py-2 text-slate-800">{row.email ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-800">{row.phone ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-800">{formatAmount(row.amount_cents)}</td>
                  <td className="px-3 py-2 text-slate-800">{row.payment_ids.length > 0 ? row.payment_ids.join(', ') : '-'}</td>
                  <td className="px-3 py-2 text-slate-800">{[row.item_state, row.payment_state].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="px-3 py-2 text-slate-800">{formatDate(row.date)}</td>
                </tr>
              ))}
              {filteredRows.length === 0 && !purchasesQuery.isLoading ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={9}>
                    {t('purchases.state.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
