/*
    ERP-CLUB - ERP pour Club de vol a voile
    - MachinesWorkspacePage: workspace Machines (équipements + familles)
 */

import { useTranslation } from 'react-i18next'
import { Tag, TableProperties, Wrench } from 'lucide-react'

import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { AssetsListPage } from './AssetsListPage'
import { AssetFamiliesPage } from './AssetFamiliesPage'
import { AssetCategoriesPage } from './AssetCategoriesPage'

export function MachinesWorkspacePage() {
  const { t } = useTranslation('assets')

  return (
    <WorkspaceShell
      title={t('workspace.machines.title', 'Machines')}
      description={t('workspace.machines.description', 'Equipements et familles de machines.')}
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
        {
          value: 'categories',
          label: t('workspace.machines.tabs.categories', 'Catégories'),
          icon: Tag,
          content: <AssetCategoriesPage />,
        },
      ]}
    />
  )
}
