/*
    ERP-CLUB - ERP pour Club de vol à voile
    - banque: RemPeriodPanel — REM period management panel
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { useCloseRemPeriodMutation } from '../api'

interface RemPeriodPanelProps {
  fiscalYearUuid: string | null
}

export function RemPeriodPanel({ fiscalYearUuid }: RemPeriodPanelProps) {
  const { t } = useTranslation(['banque', 'common'])
  const closePeriodMutation = useCloseRemPeriodMutation()

  // Current period: previous month by default
  const now = new Date()
  const [periodEnd, setPeriodEnd] = useState(
    `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}-01`,
  )

  async function handleClosePeriod() {
    if (!fiscalYearUuid || !periodEnd) return
    await closePeriodMutation.mutateAsync({
      fiscal_year_uuid: fiscalYearUuid,
      period_end: periodEnd,
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">
        {t('ops.flights.remPanel.title', 'Période REM')}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {t('ops.flights.remPanel.description', 'Clôturez la période REM en cours pour poster toutes les écritures de remise.')}
      </p>

      <div className="mt-3 flex items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">
            {t('ops.flights.remPanel.periodEnd', 'Fin de période')}
          </label>
          <input
            type="date"
            className="h-8 rounded-lg border border-slate-300 px-2 text-sm"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          onClick={handleClosePeriod}
          disabled={!fiscalYearUuid || closePeriodMutation.isPending}
        >
          {closePeriodMutation.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
          )}
          {t('ops.flights.remPanel.closePeriod', 'Clôturer la période')}
        </Button>
      </div>

      {closePeriodMutation.data && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="font-medium text-emerald-900">
              {t('ops.flights.remPanel.success', { count: closePeriodMutation.data.posted_count })}
            </span>
          </div>
          {closePeriodMutation.data.entries?.filter((e: { posted: boolean }) => !e.posted).length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              <span>
                {closePeriodMutation.data.entries.filter((e: { posted: boolean }) => !e.posted).length} échec(s)
              </span>
            </div>
          )}
        </div>
      )}

      {closePeriodMutation.error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {closePeriodMutation.error instanceof Error ? closePeriodMutation.error.message : t('common.error')}
        </div>
      )}
    </div>
  )
}
