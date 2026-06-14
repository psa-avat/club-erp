/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - planning: Gestion du planning d'activité
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
import { Calendar } from 'lucide-react'
import { WorkspaceShell } from '@/components/ui/workspace-shell'

export function PlanningPage() {
  const { t } = useTranslation('planning')

  return (
    <WorkspaceShell
      title={t('home.title', 'Planning')}
      description={t('home.description', 'Gestion du planning d\'activité')}
      tabs={[
        {
          value: 'calendar',
          label: t('tabs.calendar', 'Calendrier'),
          icon: Calendar,
          content: (
            <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card text-sm text-muted-foreground">
              <Calendar className="h-8 w-8 text-muted-foreground/50" />
              <span>{t('placeholder', 'Planning — à implémenter')}</span>
            </div>
          ),
        },
      ]}
    />
  )
}
