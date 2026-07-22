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
import { useAssetFamiliesQuery } from '../../assets/api'
import { AssetFamilyPricingPanel } from '../../assets/components/AssetFamilyPricingPanel'
import { FlightTypesPanel } from '../../assets/components/FlightTypesPanel'
import { GenericPricingPage } from './GenericPricingPage'
import { PackDefinitionsPage } from './PackDefinitionsPage'

// ── Machines sub-tab panel ────────────────────────────────────────────────────

function MachinesPricingTab() {
  const { t } = useTranslation('banque')
  const familiesQuery = useAssetFamiliesQuery()
  const families = (familiesQuery.data ?? []).filter((af) => af.is_active)

  const [selectedFamilyUuid, setSelectedFamilyUuid] = useState<string | null>(null)
  const activeFamily = families.find((af) => af.uuid === selectedFamilyUuid) ?? families[0] ?? null

  if (familiesQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">{t('states.loading')}</p>
  }

  if (families.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t('workspace.tarifs.machines.noFamilies')}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs selector */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        {families.map((af) => (
          <button
            key={af.uuid}
            type="button"
            onClick={() => setSelectedFamilyUuid(af.uuid)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              (selectedFamilyUuid ?? families[0]?.uuid) === af.uuid
                ? 'bg-primary/15 text-primary font-semibold'
                : 'bg-muted text-foreground hover:bg-muted'
            }`}
          >
            {af.name}
          </button>
        ))}
      </div>

      {/* Panel for selected family */}
      {activeFamily && (
        <AssetFamilyPricingPanel assetFamilyUuid={activeFamily.uuid} />
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
