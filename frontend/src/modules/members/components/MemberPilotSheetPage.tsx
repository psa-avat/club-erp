/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Redirect page — old pilot sheet replaced by Member Workspace
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

import { Link, useParams } from 'react-router-dom'
import { ArrowRight, MapPin } from 'lucide-react'

import { ClubPageShell } from './ClubPageShell'

/**
 * Old pilot-sheet page — redirects to the new unified Member Workspace.
 *
 * The pilot sheet functionality (accounting ledger + flight log)
 * has been replaced by the tabbed MemberWorkspaceShell at
 * `/club/members/:memberUuid/workspace`.
 * This component shows a one-time redirect notice with a direct link.
 */
export function MemberPilotSheetPage() {
  const { memberUuid } = useParams<{ memberUuid: string }>()
  const workspacePath = `/club/members/${memberUuid}/workspace`

  return (
    <ClubPageShell>
      <div className="flex flex-col items-center justify-center py-16">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <MapPin className="h-8 w-8" />
        </div>

        <h2 className="mb-2 text-xl font-semibold text-slate-800">
          Cette page a été remplacée
        </h2>

        <p className="mb-6 max-w-md text-center text-sm text-slate-600">
          La fiche pilote fait désormais partie de l'
          <span className="font-medium text-slate-700">espace membre</span>
          , qui regroupe le carnet de vol, le compte bancaire, les dépenses,
          les déclarations fiscales et les documents administratifs dans un
          seul écran organisé par onglets.
        </p>

        <Link
          to={workspacePath}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-on-primary shadow-sm hover:bg-primary/90 transition-colors"
        >
          Accéder à l'espace membre
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </ClubPageShell>
  )
}
