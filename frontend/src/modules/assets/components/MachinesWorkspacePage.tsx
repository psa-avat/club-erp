/*
    ERP-CLUB - ERP pour Club de vol a voile
    - MachinesWorkspacePage: workspace Machines (équipements + types)
 */

import { useTranslation } from 'react-i18next'
import { TableProperties, Wrench } from 'lucide-react'

import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { AssetsListPage } from './AssetsListPage'
import { AssetTypesPage } from './AssetTypesPage'

export function MachinesWorkspacePage() {
  const { t } = useTranslation('assets')

  return (
    <WorkspaceShell
      title={t('workspace.machines.title', 'Machines')}
      description={t('workspace.machines.description', 'Equipements et types de machines.')}
      tabs={[
        {
          value: 'equipements',
          label: t('workspace.machines.tabs.equipment', 'Equipements'),
          icon: Wrench,
          content: <AssetsListPage />,
        },
        {
          value: 'types',
          label: t('workspace.machines.tabs.types', 'Types'),
          icon: TableProperties,
          content: <AssetTypesPage />,
        },
      ]}
    />
  )
}
