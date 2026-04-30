/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Row-level badge and avatar components for the Members Directory table
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

import type { MemberSummary } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AVATAR_PALETTE = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
]

function pickAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

// ---------------------------------------------------------------------------
// InitialsAvatar
// ---------------------------------------------------------------------------

export function InitialsAvatar({ firstName, lastName }: { firstName: string; lastName: string }) {
  const initials = getInitials(firstName, lastName)
  const colorClass = pickAvatarColor(`${firstName}${lastName}`)
  return (
    <span
      aria-hidden="true"
      className={[
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
        colorClass,
      ].join(' ')}
    >
      {initials}
    </span>
  )
}

// ---------------------------------------------------------------------------
// RenewalWarningIcon
// ---------------------------------------------------------------------------

export function RenewalWarningIcon() {
  return (
    <svg
      aria-label="Renouvellement requis"
      className="inline-block h-3.5 w-3.5 text-orange-500"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// StatusBadge — maps member.status (1–4) to a colored pill
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<number, { label: string; className: string }> = {
  1: { label: 'Actif',          className: 'bg-green-100 text-green-800' },
  2: { label: 'Suspendu',       className: 'bg-red-100 text-red-700' },
  3: { label: 'Démissionnaire', className: 'bg-slate-100 text-slate-600' },
  4: { label: 'Anonymisé',      className: 'bg-slate-100 text-slate-400' },
}

export function StatusBadge({ status }: { status: number }) {
  const cfg = STATUS_CONFIG[status] ?? { label: `#${status}`, className: 'bg-slate-100 text-slate-600' }
  return (
    <span className={['inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', cfg.className].join(' ')}>
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// RegistrationBadge — maps registration_status (1–4)
// ---------------------------------------------------------------------------

const REG_CONFIG: Record<number, { icon: string; label: string; className: string }> = {
  1: { icon: '⏳', label: 'Brouillon',  className: 'bg-amber-100 text-amber-800' },
  2: { icon: '⏸',  label: 'En cours',   className: 'bg-blue-100 text-blue-800' },
  3: { icon: '✅', label: 'Complété',   className: 'bg-green-100 text-green-800' },
  4: { icon: '🗄',  label: 'Archivé',    className: 'bg-slate-100 text-slate-500' },
}

export function RegistrationBadge({ registrationStatus }: { registrationStatus: number }) {
  const cfg = REG_CONFIG[registrationStatus] ?? { icon: '', label: `#${registrationStatus}`, className: 'bg-slate-100 text-slate-500' }
  return (
    <span className={['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', cfg.className].join(' ')}>
      <span aria-hidden="true">{cfg.icon}</span>
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// RoleFlagBadges — renders colored compact tags for active role flags
// ---------------------------------------------------------------------------

type RoleFlagConfig = { key: keyof Pick<MemberSummary, 'is_instructor' | 'is_employee' | 'is_executive' | 'is_board_member'>; label: string; className: string }

const ROLE_FLAGS: RoleFlagConfig[] = [
  { key: 'is_instructor',  label: 'INSTRUCTEUR',  className: 'bg-blue-100 text-blue-800' },
  { key: 'is_employee',    label: 'EMPLOYÉ',      className: 'bg-purple-100 text-purple-800' },
  { key: 'is_executive',   label: 'BUREAU',       className: 'bg-orange-100 text-orange-800' },
  { key: 'is_board_member',label: 'CONSEIL',      className: 'bg-rose-100 text-rose-800' },
]

export function RoleFlagBadges({ member }: { member: MemberSummary }) {
  const active = ROLE_FLAGS.filter((f) => member[f.key])
  if (active.length === 0) {
    return <span className="text-xs text-on-surface-variant">—</span>
  }
  return (
    <span className="flex flex-wrap gap-1">
      {active.map((f) => (
        <span
          key={f.key}
          className={['inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', f.className].join(' ')}
        >
          {f.label}
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// CommissionBadge — placeholder using committee_count until backend exposes
// committee_codes per member on the list endpoint
// ---------------------------------------------------------------------------

export function CommissionBadge({ committeeCount }: { committeeCount: number }) {
  if (committeeCount === 0) {
    return <span className="text-xs text-on-surface-variant">—</span>
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      ✓ {committeeCount}
    </span>
  )
}
