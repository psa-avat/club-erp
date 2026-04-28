/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Route wrapper for journal templates screen
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
import { Navigate } from 'react-router-dom'

import { useCapability } from '../../../auth/hooks/useCapability'
import { JournalTemplatesScreen } from './JournalTemplatesScreen'

export function BanqueJournalTemplatesPage() {
  const canManageModels = useCapability('MANAGE_ACCOUNTING_SETTINGS')

  if (!canManageModels) {
    return <Navigate replace to="/banque/journal/entries" />
  }

  return <JournalTemplatesScreen />
}
