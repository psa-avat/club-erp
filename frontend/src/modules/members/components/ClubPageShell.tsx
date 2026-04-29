/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Shared page shell for club sub-pages (hero banner + sub-nav + year selector)
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
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { useMembersStore } from '../store'

function clubNavLinkClass(isActive: boolean) {
  return [
    'rounded-shape-sm border px-3 py-1.5 text-sm font-medium transition-colors',
    isActive
      ? 'border-white/40 bg-white/20 text-white'
      : 'border-white/10 bg-slate-950/10 text-emerald-50/80 hover:border-white/20 hover:bg-white/10',
  ].join(' ')
}

export function ClubPageShell({
  children,
}: {
  children: React.ReactNode
}) {
  const { t } = useTranslation('common')
  const { t: tM } = useTranslation('members')
  const { selectedYear, setSelectedYear } = useMembersStore()

  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-shape-lg border border-outline-variant bg-gradient-to-r from-sky-950 via-teal-900 to-emerald-800 text-white shadow-surface-2">
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between md:p-8">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">{tM('hero.kicker')}</p>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{tM('hero.title')}</h1>
            <p className="max-w-2xl text-sm text-emerald-50/85">{tM('hero.description')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
            <Label className="whitespace-nowrap text-xs text-emerald-50" htmlFor="club-year">
              {tM('filters.year')}
            </Label>
            <Input
              id="club-year"
              className="h-8 w-20 border-white/20 bg-white/90 text-sm text-slate-900"
              type="number"
              value={selectedYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
            />
          </div>
        </div>
        <nav
          className="flex flex-wrap gap-2 border-t border-white/10 bg-slate-950/20 px-6 py-3"
          aria-label={t('nav.club')}
        >
          <NavLink
            to="/club/members"
            className={({ isActive }) => clubNavLinkClass(isActive)}
            aria-current={undefined}
          >
            {t('nav.clubMembers')}
          </NavLink>
          <NavLink
            to="/club/committees"
            className={({ isActive }) => clubNavLinkClass(isActive)}
            aria-current={undefined}
          >
            {t('nav.clubCommittees')}
          </NavLink>
          <NavLink
            to="/club/sheets"
            className={({ isActive }) => clubNavLinkClass(isActive)}
            aria-current={undefined}
          >
            {t('nav.clubSheets')}
          </NavLink>
        </nav>
      </div>
      {children}
    </section>
  )
}
