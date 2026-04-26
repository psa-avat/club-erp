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

  export interface NavigateOptions {
    replace?: boolean
    state?: unknown
    relative?: 'route' | 'path'
  }

  export interface NavigateFunction {
    (to: string, options?: NavigateOptions): void
    (delta: number): void
  }

  export interface Location {
    pathname: string
    search: string
    hash: string
    state: unknown
    key: string
  }

  export type To = string | { pathname?: string; search?: string; hash?: string }

  export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    to: To
    replace?: boolean
    state?: unknown
    reloadDocument?: boolean
    preventScrollReset?: boolean
    relative?: 'route' | 'path'
    children?: React.ReactNode
  }

  export interface NavLinkProps extends Omit<LinkProps, 'className' | 'style'> {
    className?: string | ((props: { isActive: boolean; isPending: boolean }) => string | undefined)
    style?: React.CSSProperties | ((props: { isActive: boolean; isPending: boolean }) => React.CSSProperties | undefined)
    end?: boolean
    caseSensitive?: boolean
    children?: React.ReactNode | ((props: { isActive: boolean; isPending: boolean }) => React.ReactNode)
  }

  export interface NavigateProps {
    to: To
    replace?: boolean
    state?: unknown
    relative?: 'route' | 'path'
  }

  export interface RouteProps {
    path?: string
    index?: boolean
    element?: React.ReactNode
    children?: React.ReactNode
    caseSensitive?: boolean
    id?: string
  }

  export interface RouterProps {
    children?: React.ReactNode
  }

  export function BrowserRouter(props: RouterProps): React.JSX.Element
  export function Routes(props: { children?: React.ReactNode; location?: Partial<Location> | string }): React.JSX.Element
  export function Route(props: RouteProps): React.JSX.Element
  export function Navigate(props: NavigateProps): React.JSX.Element
  export function Outlet(props: { context?: unknown }): React.JSX.Element
  export function Link(props: LinkProps): React.JSX.Element
  export function NavLink(props: NavLinkProps): React.JSX.Element

  export function useNavigate(): NavigateFunction
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T
  export function useLocation(): Location
  export function useOutletContext<T = unknown>(): T
}

declare module 'react-i18next' {
  export const initReactI18next: { type: '3rdParty'; init(i18n: unknown): void }

  export interface TFunction {
    (key: string): string
    (key: string, options: Record<string, unknown>): string
    (key: string, defaultValue: string, options?: Record<string, unknown>): string
  }

  export interface I18nInstance {
    language: string
    changeLanguage(lang: string): Promise<TFunction>
    t: TFunction
    use(plugin: unknown): I18nInstance
    init(options: Record<string, unknown>): Promise<TFunction>
  }

  export interface UseTranslationResponse {
    t: TFunction
    i18n: I18nInstance
    ready: boolean
  }

  export function useTranslation(namespace?: string | string[]): UseTranslationResponse
  export function Trans(props: {
    i18nKey?: string
    children?: React.ReactNode
    values?: Record<string, unknown>
    components?: Record<string, React.ReactElement>
  }): React.JSX.Element
}