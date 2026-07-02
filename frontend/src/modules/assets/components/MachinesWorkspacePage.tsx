/*
    ERP-CLUB - ERP pour Club de vol a voile
    - MachinesWorkspacePage: workspace Machines (équipements + familles)
 */

import { useTranslation } from 'react-i18next'
import { TableProperties, Wrench } from 'lucide-react'

import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { AssetsListPage } from './AssetsListPage'
import { AssetFamiliesPage } from './AssetFamiliesPage'

export function MachinesWorkspacePage() {
  const { t } = useTranslation('assets')

  return (
    <WorkspaceShell
      title={t('workspace.machines.title', 'Équipements')}
      description={t('workspace.machines.description', 'Équipements et familles.')}
      tabs={[
        {
          value: 'equipements',
          label: t('workspace.machines.tabs.equipment', 'Equipements'),
          icon: Wrench,
          content: <AssetsListPage />,
        },
        {
          value: 'families',
          label: t('workspace.machines.tabs.families', 'Familles'),
          icon: TableProperties,
          content: <AssetFamiliesPage />,
        },
      ]}
    />
  )
}
