/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque: Route wrapper for journal entry workspace screen
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
import { Navigate, useLocation, useParams } from 'react-router-dom'

import { useCapability } from '../../../auth/hooks/useCapability'
import { JournalEntryWorkspaceScreen } from './JournalEntryWorkspaceScreen'

export function BanqueJournalEntryWorkspacePage() {
  const { entryUuid } = useParams<{ entryUuid: string }>()
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const canPost = useCapability('POST_ACCOUNTING_ENTRIES')

  if (!canPost) {
    return <Navigate replace to="/banque/journal/entries" />
  }

  return (
    <JournalEntryWorkspaceScreen
      entryUuid={entryUuid ?? null}
      entryFiscalYearUuid={searchParams.get('fiscal_year_uuid')}
    />
  )
}
