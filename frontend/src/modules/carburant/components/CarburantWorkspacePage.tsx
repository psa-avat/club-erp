/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - CarburantWorkspacePage: Workspace Carburant (tabs: pompes)
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

import { useTranslation } from 'react-i18next'
import { Fuel } from 'lucide-react'

import { WorkspaceShell } from '@/components/ui/workspace-shell'

import { PompesAdminPage } from './PompesAdminPage'

export function CarburantWorkspacePage() {
  const { t } = useTranslation('carburant')

  return (
    <WorkspaceShell
      title={t('admin.workspace.title')}
      description={t('admin.workspace.description')}
      tabs={[
        {
          value: 'pompes',
          label: t('admin.workspace.tabs.pompes'),
          icon: Fuel,
          content: <PompesAdminPage />,
        },
      ]}
    />
  )
}
