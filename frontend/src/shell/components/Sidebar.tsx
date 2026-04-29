import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '../../auth/store/authStore'
import { shellNavItems } from '../navigation'

const linkBase = 'block rounded-shape-sm px-3 py-2 text-sm font-medium transition-colors'
const linkActive = 'bg-primary text-on-primary'
const linkIdle = 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'

export function Sidebar() {
  const { t } = useTranslation('common')
  const capabilities = useAuthStore((state) => state.user?.capabilities ?? [])
  const location = useLocation()

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
    <aside className="hidden w-64 shrink-0 border-r border-outline-variant bg-surface md:block">
      <nav className="space-y-0.5 p-3">
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
                    >
                      {t(child.labelKey)}
                    </NavLink>
                  ))}
                </div>
              </div>
            )
          }

          // Regular flat link (or collapsed group — clicking enters the group)
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/dashboard'}
              className={({ isActive }) =>
                [linkBase, isActive ? linkActive : linkIdle].join(' ')
              }
            >
              {t(link.labelKey)}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
