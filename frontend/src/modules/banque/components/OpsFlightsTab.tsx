/*
    ERP-CLUB - ERP pour Club de vol à voile
    - OpsFlightsTab: Daily operations flights billing cockpit
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
import { ChevronDown, ChevronRight, Play, Send, RotateCw } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { useCapability } from '../../../auth/hooks/useCapability'

// ── Inline types (backend schema not yet shared) ──────────────────────────

type BillableFlight = {
  uuid: string
  planche_uuid: string | null
  jour: string | null
  pilot_erp_id: string | null
  asset_code: string | null
  type_of_flight: number | null
  status: string
}

// ── Component ─────────────────────────────────────────────────────────────

export function OpsFlightsTab() {
  const { t } = useTranslation(['banque', 'common'])
  const canManage = useCapability('MANAGE_PRICES')
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')

  const [expandedFlight, setExpandedFlight] = useState<string | null>(null)
  const [flights] = useState<BillableFlight[]>([])
  const [loading] = useState(false)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="h-8 rounded-lg border border-slate-300 px-2 text-sm"
          />
          <span className="text-xs text-slate-400">→</span>
          <input
            type="date"
            className="h-8 rounded-lg border border-slate-300 px-2 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={loading}>
            <RotateCw className="mr-1 h-3.5 w-3.5" />
            {t('common.loading')}
          </Button>
          {canManage && (
            <Button size="sm" variant="secondary" disabled={loading || flights.length === 0}>
              <Play className="mr-1 h-3.5 w-3.5" />
              Preview
            </Button>
          )}
          {canPost && (
            <Button size="sm" disabled={loading || flights.length === 0}>
              <Send className="mr-1 h-3.5 w-3.5" />
              Appliquer
            </Button>
          )}
        </div>
      </div>

      {/* Flights table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {flights.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center">
            <p className="text-sm text-slate-400">{t('ops.comingSoon')}</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3 font-medium text-slate-600">Date</th>
                <th className="px-4 py-3 font-medium text-slate-600">Pilote</th>
                <th className="px-4 py-3 font-medium text-slate-600">Machine</th>
                <th className="px-4 py-3 font-medium text-slate-600">Type</th>
                <th className="px-4 py-3 font-medium text-slate-600">Statut</th>
                <th className="px-4 py-3 font-medium text-slate-600">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <tr key={f.uuid} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                      onClick={() => setExpandedFlight(expandedFlight === f.uuid ? null : f.uuid)}
                    >
                      {expandedFlight === f.uuid ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{f.jour ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{f.pilot_erp_id ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{f.asset_code ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {f.type_of_flight ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      {f.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded p-1 text-slate-400 hover:text-slate-700"
                        title="Aperçu"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
