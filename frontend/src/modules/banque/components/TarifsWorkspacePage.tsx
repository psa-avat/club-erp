/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - TarifsWorkspacePage: Workspace Tarifs unifié (génériques, machines, forfaits, types de vol)
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
import { LayoutGrid, Tags, Plane, Wind } from 'lucide-react'

import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { useAssetTypesQuery } from '../../assets/api'
import { AssetTypePricingPanel } from '../../assets/components/AssetTypePricingPanel'
import { FlightTypesPanel } from '../../assets/components/FlightTypesPanel'
import { GenericPricingPage } from './GenericPricingPage'
import { PackDefinitionsPage } from './PackDefinitionsPage'

// ── Machines sub-tab panel ────────────────────────────────────────────────────

function MachinesPricingTab() {
  const { t } = useTranslation('banque')
  const typesQuery = useAssetTypesQuery()
  const types = (typesQuery.data ?? []).filter((at) => at.is_active)

  const [selectedTypeUuid, setSelectedTypeUuid] = useState<string | null>(null)
  const activeType = types.find((at) => at.uuid === selectedTypeUuid) ?? types[0] ?? null

  if (typesQuery.isLoading) {
    return <p className="text-sm text-on-surface-variant">{t('states.loading')}</p>
  }

  if (types.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-outline-variant p-6 text-center text-sm text-on-surface-variant">
        {t('workspace.tarifs.machines.noTypes')}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs selector */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-outline-variant bg-surface px-4 py-3 shadow-sm">
        {types.map((at) => (
          <button
            key={at.uuid}
            type="button"
            onClick={() => setSelectedTypeUuid(at.uuid)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              (selectedTypeUuid ?? types[0]?.uuid) === at.uuid
                ? 'bg-primary-container text-on-primary-container font-semibold'
                : 'bg-surface-container text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            {at.name}
          </button>
        ))}
      </div>

      {/* Panel for selected type */}
      {activeType && (
        <AssetTypePricingPanel assetTypeUuid={activeType.uuid} />
      )}
    </div>
  )
}

// ── Main workspace ────────────────────────────────────────────────────────────

export function TarifsWorkspacePage() {
  const { t } = useTranslation('banque')

  return (
    <WorkspaceShell
      title={t('workspace.tarifs.title', 'Tarifs')}
      description={t('workspace.tarifs.description', 'Grille tarifaire et catalogue de forfaits.')}
      tabs={[
        {
          value: 'generiques',
          label: t('workspace.tarifs.tabs.generiques', 'Génériques'),
          icon: LayoutGrid,
          content: <GenericPricingPage />,
        },
        {
          value: 'machines',
          label: t('workspace.tarifs.tabs.machines', 'Machines'),
          icon: Plane,
          content: <MachinesPricingTab />,
        },
        {
          value: 'packs',
          label: t('workspace.tarifs.tabs.packs', 'Forfaits'),
          icon: Tags,
          content: <PackDefinitionsPage />,
        },
        {
          value: 'flight-types',
          label: t('workspace.tarifs.tabs.flightTypes', 'Types de vol'),
          icon: Wind,
          content: <FlightTypesPanel />,
        },
      ]}
    />
  )
}
