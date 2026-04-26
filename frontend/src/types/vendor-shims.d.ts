/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - frontend types: local shims for editor/type resolution of frontend vendor modules
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

declare module 'react-router-dom' {
  import * as React from 'react'

  export interface NavigateFunction {
    (to: string): void
    (delta: number): void
  }

  export function BrowserRouter(props: { children?: React.ReactNode }): React.JSX.Element
  export function useNavigate(): NavigateFunction
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T
}

declare module 'react-i18next' {
  export function useTranslation(namespace?: string): {
    t: (key: string, options?: Record<string, unknown>) => string
  }
}