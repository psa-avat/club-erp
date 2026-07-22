/*
    ERP-CLUB - ERP pour Club de vol a voile
    - Logiciel libre de gestion d'un club de vol a voile
    - planche: pilots missing debug component
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

import { usePilotsMissingErpIdQuery, usePilotsOrphanedQuery, type PlanchePilot } from '../api'

function PilotTable({ pilots, title }: { pilots: PlanchePilot[]; title: string }) {
  const { t } = useTranslation('planche')
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-900">{t('membersPush.debug.tableNo')}</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-900">{t('membersPush.debug.tableNom')}</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-900">{t('membersPush.debug.tablePrenom')}</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-900">{t('membersPush.debug.tableFFVP')}</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-900">{t('membersPush.debug.tableIdCompta')}</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-900">{t('membersPush.debug.tableErpId')}</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-900">{t('membersPush.debug.tableActif')}</th>
            </tr>
          </thead>
          <tbody>
            {pilots.map((pilot, index) => (
              <tr key={`${pilot.no}-${index}`} className="border-b border-border hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-900">{pilot.no}</td>
                <td className="px-3 py-2 text-slate-900">{pilot.nom}</td>
                <td className="px-3 py-2 text-slate-900">{pilot.prenom}</td>
                <td className="px-3 py-2 text-slate-900">{pilot.ffvp}</td>
                <td className="px-3 py-2 font-mono text-slate-600">{pilot.id_compta}</td>
                <td className={`px-3 py-2 font-mono ${pilot.erp_id ? 'text-green-700' : 'text-red-700'}`}>
                  {pilot.erp_id || '—'}
                </td>
                <td className="px-3 py-2">
                  {pilot.isActif === 1 || pilot.isActif === true ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                      {t('membersPush.debug.statusActif')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-800">
                      {t('membersPush.debug.statusInactif')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PilotsMissingDebug() {
  const { t } = useTranslation('planche')
  const [showMissingErpId, setShowMissingErpId] = useState(false)
  const [showOrphaned, setShowOrphaned] = useState(false)

  const missingErpIdQuery = usePilotsMissingErpIdQuery(showMissingErpId)
  const orphanedQuery = usePilotsOrphanedQuery(showOrphaned)

  return (
    <div className="space-y-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
      <p className="text-sm font-semibold text-yellow-900">{t('membersPush.debug.title')}</p>

      <div className="space-y-2">
        <button
          onClick={() => setShowMissingErpId(!showMissingErpId)}
          className="inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-yellow-900 hover:bg-yellow-100"
        >
          <span>{showMissingErpId ? '▼' : '▶'}</span>
          {t('membersPush.debug.missingErpIdTitle', { count: missingErpIdQuery.data?.count ?? 0 })}
        </button>
        {showMissingErpId && (
          <div className="pl-4">
            {missingErpIdQuery.isLoading && <p className="text-sm text-slate-600">{t('membersPush.debug.loading')}</p>}
            {missingErpIdQuery.error && (
              <p className="text-sm text-red-700">
                {t('membersPush.debug.error', { message: String(missingErpIdQuery.error) })}
              </p>
            )}
            {missingErpIdQuery.data?.pilots && missingErpIdQuery.data.pilots.length > 0 ? (
              <PilotTable pilots={missingErpIdQuery.data.pilots} title={t('membersPush.debug.missingErpIdDescription')} />
            ) : (
              <p className="text-sm text-slate-600">{t('membersPush.debug.emptyMissing')}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <button
          onClick={() => setShowOrphaned(!showOrphaned)}
          className="inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-yellow-900 hover:bg-yellow-100"
        >
          <span>{showOrphaned ? '▼' : '▶'}</span>
          {t('membersPush.debug.orphanedTitle', { count: orphanedQuery.data?.count ?? 0 })}
        </button>
        {showOrphaned && (
          <div className="pl-4">
            {orphanedQuery.isLoading && <p className="text-sm text-slate-600">{t('membersPush.debug.loading')}</p>}
            {orphanedQuery.error && (
              <p className="text-sm text-red-700">
                {t('membersPush.debug.error', { message: String(orphanedQuery.error) })}
              </p>
            )}
            {orphanedQuery.data?.pilots && orphanedQuery.data.pilots.length > 0 ? (
              <PilotTable pilots={orphanedQuery.data.pilots} title={t('membersPush.debug.orphanedDescription')} />
            ) : (
              <p className="text-sm text-slate-600">{t('membersPush.debug.emptyOrphaned')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
