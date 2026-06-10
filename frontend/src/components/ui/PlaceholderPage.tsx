/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - PlaceholderPage: page vide réutilisable pour les fonctionnalités pas encore implémentées
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

import { Clock } from 'lucide-react'

interface PlaceholderPageProps {
  title: string
  description: string
  /** Optional estimated availability (e.g. "Phase 7", "Semaine 12") */
  eta?: string
}

/**
 * PlaceholderPage — page vide pour les fonctionnalités planifiées mais pas encore
 * implémentées. Affiche un titre, une description et un badge "À venir".
 */
export function PlaceholderPage({ title, description, eta }: PlaceholderPageProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-blue-50">
        <Clock className="size-8 text-blue-500" aria-hidden="true" />
      </div>
      <h1 className="mb-2 text-xl font-semibold text-gray-900">{title}</h1>
      <p className="mb-6 max-w-md text-sm text-gray-500">{description}</p>
      <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
        À venir
        {eta && <span className="ml-1 text-blue-500">· {eta}</span>}
      </span>
    </div>
  )
}
