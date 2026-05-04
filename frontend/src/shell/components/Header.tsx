import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useCurrentUser, useLogout } from '../../auth/api/useAuth'
import { ChangePasswordDialog } from '../../auth/components/ChangePasswordDialog'
import { useAuthStore } from '../../auth/store/authStore'
import { Button } from '../../components/ui/button'
import { useActiveFiscalYearQuery, useFiscalYearsQuery } from '../../modules/banque/api'
import type { FiscalYear } from '../../modules/banque/api'
import { useFiscalYearStore } from '../../store/fiscalYearStore'
import { shellNavItems } from '../navigation'

// ── FY state badge colours ────────────────────────────────────────────────────

function fyStateBadgeClass(state: number): string {
  if (state === 1) return 'bg-teal-100 text-teal-800'       // Open
  if (state === 3) return 'bg-amber-100 text-amber-800'     // Reopened
  return 'bg-slate-100 text-slate-600'                      // Closed
}

function fyStateLabel(state: number): string {
  if (state === 1) return 'Open'
  if (state === 3) return 'Reopened'
  return 'Closed'
}

// ── Fiscal Year Selector widget ───────────────────────────────────────────────

type FiscalYearSelectorProps = {
  fiscalYears: FiscalYear[]
  activeFiscalYearUuid: string | null
  onSelect: (uuid: string) => void
}

function FiscalYearSelector({ fiscalYears, activeFiscalYearUuid, onSelect }: FiscalYearSelectorProps) {
  const activeFY = fiscalYears.find((fy) => fy.uuid === activeFiscalYearUuid) ?? fiscalYears[0]

  return (
    <div className="flex items-center gap-1.5">
      {activeFY ? (
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${fyStateBadgeClass(activeFY.state)}`}>
          {fyStateLabel(activeFY.state)}
        </span>
      ) : null}
      <select
        aria-label="Fiscal year"
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
        value={activeFiscalYearUuid ?? ''}
        onChange={(e) => { if (e.target.value) onSelect(e.target.value) }}
      >
        {fiscalYears.map((fy) => (
          <option key={fy.uuid} value={fy.uuid}>
            {fy.code}
          </option>
        ))}
      </select>
    </div>
  )
}

type HeaderProps = {
  onOpenMobileMenu: () => void
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { i18n, t } = useTranslation('common')
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const capabilities = useAuthStore((state) => state.user?.capabilities ?? [])
  const logoutMutation = useLogout()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const meQuery = useCurrentUser(Boolean(token))
  const canChangePassword = meQuery.data?.can_change_password !== false

  const activeFiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid)
  const setActiveFiscalYear = useFiscalYearStore((s) => s.setActiveFiscalYear)
  const activeFiscalYearQuery = useActiveFiscalYearQuery(Boolean(token))
  const fiscalYearsQuery = useFiscalYearsQuery(Boolean(token))
  const fiscalYears = fiscalYearsQuery.data ?? []

  // Initialise store on first load — pick active/most-recent FY from backend
  useEffect(() => {
    if (!activeFiscalYearUuid && activeFiscalYearQuery.data) {
      const fy = activeFiscalYearQuery.data
      setActiveFiscalYear(fy.uuid, fy)
    }
  }, [activeFiscalYearUuid, activeFiscalYearQuery.data, setActiveFiscalYear])

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  async function handleLogout() {
    setMenuOpen(false)
    await logoutMutation.mutateAsync()
    navigate('/', { replace: true })
  }

  const initials = [user?.prenom?.[0], user?.nom?.[0]].filter(Boolean).join('').toUpperCase() || 'U'

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

  const activeModule = visibleLinks.find((item) =>
    item.to === '/dashboard'
      ? location.pathname === '/dashboard'
      : location.pathname === item.to ||
        location.pathname.startsWith(item.to + '/') ||
        (item.children ?? []).some(
          (child) =>
            location.pathname === child.to || location.pathname.startsWith(child.to + '/'),
        )
  )

  return (
    <header className="sticky top-0 z-40 border-b border-outline-variant bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          <button
            aria-label={t('nav.openMenu')}
            className="rounded-shape-xs border border-outline px-2 py-1 text-sm text-on-surface-variant hover:bg-surface-variant md:hidden"
            type="button"
            onClick={onOpenMobileMenu}
          >
            {t('nav.openMenu')}
          </button>
          {activeModule && activeModule.to !== '/dashboard' && (
            <Link
              className="rounded-shape-xs bg-surface-container px-2 py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high md:hidden"
              to={activeModule.to}
            >
              {t(activeModule.labelKey)}
            </Link>
          )}
          <Link className="text-lg font-semibold text-on-surface" to="/dashboard">
            {t('app.name')}
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <select
            aria-label="Language"
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
            value={i18n.language}
            onChange={(event) => { void i18n.changeLanguage(event.target.value) }}
          >
            <option value="fr">FR</option>
            <option value="en">EN</option>
          </select>

          {token && fiscalYears.length > 0 ? (
            <FiscalYearSelector
              fiscalYears={fiscalYears}
              activeFiscalYearUuid={activeFiscalYearUuid}
              onSelect={(uuid) => {
                const fy = fiscalYears.find((f) => f.uuid === uuid)
                if (fy) setActiveFiscalYear(fy.uuid, fy)
              }}
            />
          ) : null}

          {token ? (
            <div className="relative" ref={menuRef}>
              {/* Avatar trigger */}
              <button
                className="flex items-center gap-2 rounded-full border border-outline bg-surface px-2 py-1 transition-colors hover:bg-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-semibold text-on-primary">
                  {initials}
                </div>
                <div className="hidden pr-1 text-left leading-tight md:block">
                  <p className="text-xs font-semibold text-on-surface">{user?.prenom} {user?.nom}</p>
                  <p className="text-xs text-on-surface-variant">{user?.email ?? t('auth.activeSession')}</p>
                </div>
                <svg className="h-4 w-4 text-on-surface-variant" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Dropdown */}
              {menuOpen ? (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-shape-md border border-outline-variant bg-surface py-1 shadow-surface-3">
                  <div className="border-b border-outline-variant px-4 py-2">
                    <p className="text-sm font-semibold text-on-surface">{user?.prenom} {user?.nom}</p>
                    <p className="truncate text-xs text-on-surface-variant">{user?.email}</p>
                  </div>

                  {canChangePassword ? (
                    <button
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-on-surface hover:bg-surface-variant"
                      type="button"
                      onClick={() => { setMenuOpen(false); setShowChangePassword(true) }}
                    >
                      <svg className="h-4 w-4 text-on-surface-variant" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {t('auth.changePassword.title')}
                    </button>
                  ) : null}

                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                    disabled={logoutMutation.isPending}
                    type="button"
                    onClick={() => { void handleLogout() }}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {logoutMutation.isPending ? t('auth.logoutLoading') : t('auth.logout')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <Button size="sm" onClick={() => navigate('/login')}>
              {t('auth.login')}
            </Button>
          )}
        </div>
      </div>

      {showChangePassword ? (
        <ChangePasswordDialog onClose={() => setShowChangePassword(false)} />
      ) : null}
    </header>
  )
}

