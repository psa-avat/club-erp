/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Daily accounting operations hub — 6-tab shell (Phase 0 cadre)
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
import { useCapability } from '../../../auth/hooks/useCapability'
import { useFiscalYearStore } from '../../../store/fiscalYearStore'
import { OpsSupplierTab } from './OpsSupplierTab'
import { OpsSalesTab } from './OpsSalesTab'
import { OpsFlightsTab } from './OpsFlightsTab'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpsTab = 'dashboard' | 'suppliers' | 'sales' | 'flights' | 'payments' | 'payroll'

const OPS_TABS: OpsTab[] = ['dashboard', 'suppliers', 'sales', 'flights', 'payments', 'payroll']

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BanqueDailyOpsPage() {
  const { t } = useTranslation('banque')
  const canView = useCapability('VIEW_FINANCIALS')
  const [activeTab, setActiveTab] = useState<OpsTab>('dashboard')
  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('journal.noPermission')}</p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{t('ops.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('ops.description')}</p>
      </div>

      {/* Tab shell */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Tab bar */}
        <div
          className="flex overflow-x-auto border-b border-slate-200"
          role="tablist"
          aria-label={t('ops.title')}
        >
          {OPS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`ops-tab-${tab}`}
              aria-selected={activeTab === tab}
              aria-controls={`ops-panel-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={[
                'whitespace-nowrap border-b-2 px-5 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
                activeTab === tab
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
              ].join(' ')}
            >
              {t(`ops.tabs.${tab}`)}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        {OPS_TABS.map((tab) => (
          <div
            key={tab}
            id={`ops-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`ops-tab-${tab}`}
            hidden={activeTab !== tab}
            className="p-6"
          >
            {tab === 'suppliers' && activeFiscalYearUuid ? (
              <OpsSupplierTab fiscalYearUuid={activeFiscalYearUuid} />
            ) : tab === 'sales' && activeFiscalYearUuid ? (
              <OpsSalesTab fiscalYearUuid={activeFiscalYearUuid} />
            ) : tab === 'flights' ? (
              <OpsFlightsTab />
            ) : (
              <OpsTabPlaceholder tab={tab} t={t} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholder – replaced per-tab in Phase 1–7
// ---------------------------------------------------------------------------

function OpsTabPlaceholder({ tab, t }: { tab: OpsTab; t: (key: string) => string }) {
  const descriptions: Record<OpsTab, string> = {
    dashboard: t('ops.placeholders.dashboard'),
    suppliers: t('ops.placeholders.suppliers'),
    sales: t('ops.placeholders.sales'),
    flights: t('ops.placeholders.flights'),
    payments: t('ops.placeholders.payments'),
    payroll: t('ops.placeholders.payroll'),
  }

  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center">
      <p className="text-sm font-medium text-slate-700">{t(`ops.tabs.${tab}`)}</p>
      <p className="max-w-sm text-xs text-slate-400">{descriptions[tab]}</p>
      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-400">
        {t('ops.comingSoon')}
      </span>
    </div>
  )
}
