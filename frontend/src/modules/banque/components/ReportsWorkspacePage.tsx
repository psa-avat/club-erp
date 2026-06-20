/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Reports workspace – financial statements and grand livre
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
import { BarChart3, BookOpen } from 'lucide-react'

import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { FinancialReportsPage } from './FinancialReportsPage'
import { GrandLivreScreen } from './GrandLivreScreen'

export function ReportsWorkspacePage() {
  const { t } = useTranslation('banque')

  return (
    <WorkspaceShell
      title={t('workspace.reports.title', 'Rapports financiers')}
      description={t('workspace.reports.description', 'États financiers et grand livre analytique.')}
      tabs={[
        {
          value: 'bilans',
          label: t('workspace.reports.tabs.statements', 'Résultat & Bilan'),
          icon: BarChart3,
          content: <FinancialReportsPage />,
        },
        {
          value: 'grand-livre',
          label: t('workspace.reports.tabs.ledger', 'Grand livre'),
          icon: BookOpen,
          content: <GrandLivreScreen />,
        },
      ]}
    />
  )
}
