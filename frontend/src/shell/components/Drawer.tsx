/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Drawer: menu de navigation en tiroir (side drawer) — remplace Sidebar + MobileDrawer
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

import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '../../auth/store/authStore'
import { shellNavItems } from '../navigation'

const linkBase = 'block rounded-shape-sm px-3 py-2 text-sm font-medium transition-colors'
const linkActive = 'bg-primary text-on-primary'
const linkIdle = 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'

type DrawerProps = {
  open: boolean
  onClose: () => void
}

export function Drawer({ open, onClose }: DrawerProps) {
  const { t } = useTranslation('common')
  const capabilities = useAuthStore((state) => state.user?.capabilities ?? [])
  const location = useLocation()

  if (!open) return null

  const visibleLinks = shellNavItems
    .map((link) => ({
      ...link,
      children: (link.children ?? []).filter(
        (child) => !child.requiredCapability || capabilities.includes(child.requiredCapability),
      ),
    }))
    .filter(
      (link) =>
        !link.requiredCapability ||
        capabilities.includes(link.requiredCapability) ||
        (link.children?.length ?? 0) > 0,
    )

  return (
    <div
      className="fixed inset-0 z-50 bg-primary/20"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="h-full w-72 overflow-y-auto bg-surface p-3 shadow-surface-4">
        <div className="mb-3 flex items-center justify-between border-b border-outline-variant pb-3">
          <p className="text-sm font-semibold text-on-surface">{t('nav.modules')}</p>
          <button
            aria-label={t('nav.closeMenu')}
            className="rounded-shape-xs border border-outline px-2 py-1 text-sm text-on-surface-variant hover:bg-surface-container"
            type="button"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <nav className="space-y-0.5">
          {visibleLinks.map((link) => {
            const isGroupActive =
              link.to === '/dashboard'
                ? location.pathname === '/dashboard'
                : location.pathname === link.to ||
                  location.pathname.startsWith(link.to + '/') ||
                  (link.children ?? []).some(
                    (child) =>
                      location.pathname === child.to || location.pathname.startsWith(child.to + '/'),
                  )

            // Expandable group: show section header + children when active
            if (link.children && link.children.length > 0 && isGroupActive) {
              return (
                <div key={link.to} className="space-y-0.5">
                  <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                    {t(link.labelKey)}
                  </p>
                  <div className="space-y-0.5 border-l-2 border-outline-variant ml-2 pl-1">
                    {link.children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        end={child.to === link.to}
                        className={({ isActive }) =>
                          [linkBase, isActive ? linkActive : linkIdle].join(' ')
                        }
                        onClick={onClose}
                      >
                        {t(child.labelKey)}
                      </NavLink>
                    ))}
                  </div>
                </div>
              )
            }

            // Regular flat link (or collapsed group)
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/dashboard'}
                className={({ isActive }) =>
                  [linkBase, isActive ? linkActive : linkIdle].join(' ')
                }
                onClick={onClose}
              >
                {t(link.labelKey)}
              </NavLink>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
