/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Dense directory table for the Members Directory page
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

import { useEffect, useRef, useState } from 'react'
import { MoreVertical, Pencil, ScrollText } from 'lucide-react'

import { DataTable } from '../../../components/ui/data-table'
import type { ColumnDef } from '../../../components/ui/data-table'
import type { MemberSummary } from '../types'
import { memberCategoryLabel } from './membersShared'
import {
  CommissionBadge,
  InitialsAvatar,
  RegistrationBadge,
  RenewalWarningIcon,
  RoleFlagBadges,
  StatusBadge,
} from './MemberRowBadges'

// ---------------------------------------------------------------------------
// Kebab dropdown
// ---------------------------------------------------------------------------

type KebabItem = { label: string; onClick: () => void; disabled?: boolean }

function KebabMenu({ items }: { items: KebabItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Plus d'actions"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-[180px] rounded-shape-sm border border-outline-variant bg-surface py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="w-full px-3 py-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                if (item.disabled) {
                  return
                }
                item.onClick()
                setOpen(false)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MemberDirectoryTable
// ---------------------------------------------------------------------------

type Props = {
  members: MemberSummary[]
  isLoading: boolean
  selectedMemberId: string | null
  selectedYear: number
  allowRegistrationWorkflow: boolean
  onEditMember: (uuid: string) => void
  onFinalizeRegistration: (uuid: string) => void
  onOpenPilotSheet: (uuid: string) => void
}

const PAGE_SIZE = 25

function formatIsoDate(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }

  const parsedDate = new Date(value)
  if (Number.isNaN(parsedDate.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('fr-FR').format(parsedDate)
}

export function MemberDirectoryTable({
  members,
  isLoading,
  selectedMemberId,
  selectedYear,
  allowRegistrationWorkflow,
  onEditMember,
  onFinalizeRegistration,
  onOpenPilotSheet,
}: Props) {
  const [currentPage, setCurrentPage] = useState(1)

  // Reset to first page whenever the data changes (filter applied)
  useEffect(() => {
    setCurrentPage(1)
  }, [members])

  const totalPages = Math.max(1, Math.ceil(members.length / PAGE_SIZE))
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageEnd = Math.min(pageStart + PAGE_SIZE, members.length)
  const visibleMembers = members.slice(pageStart, pageEnd)
  const columns: ColumnDef<MemberSummary>[] = [
    {
      key: 'name',
      header: 'Nom & Identifiant',
      sortable: true,
      className: 'min-w-[200px]',
      cell: (row) => {
        const isPermanentCategory = [5, 7, 8].includes(row.member_category)
        const needsRenewal = row.status === 1 && !isPermanentCategory && row.registration_status !== 2
        return (
          <div className="flex items-center gap-3">
            <InitialsAvatar firstName={row.first_name} lastName={row.last_name} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium text-on-surface">
                  {row.first_name} {row.last_name}
                </span>
                {needsRenewal ? <RenewalWarningIcon /> : null}
              </div>
              <span className="font-mono text-xs text-on-surface-variant">
                {row.account_id}
                {row.ffvp_id ? (
                  <>
                    {' '}
                    <span className="text-slate-400">|</span>{' '}
                    <span title="FFVP ID">{row.ffvp_id}</span>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        )
      },
    },
    {
      key: 'category',
      header: 'Catégorie',
      sortable: true,
      className: 'min-w-[120px]',
      cell: (row) => (
        <span className="text-sm text-on-surface">{memberCategoryLabel(row.member_category)}</span>
      ),
    },
    {
      key: 'roles',
      header: 'Rôles',
      // Hidden on mobile via headerClassName + className responsive utilities
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell min-w-[140px]',
      cell: (row) => <RoleFlagBadges member={row} />,
    },
    {
      key: 'status',
      header: 'Statut opérationnel',
      sortable: true,
      className: 'min-w-[130px]',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'registration',
      header: `Inscription ${selectedYear}`,
      sortable: true,
      // Hidden on small screens
      headerClassName: 'hidden sm:table-cell',
      className: 'hidden sm:table-cell min-w-[220px]',
      cell: (row) => (
        <div className="space-y-1">
          <RegistrationBadge registrationStatus={row.registration_status} />
          {row.is_registered_for_year && row.registration_start_date_for_year && row.registration_end_date_for_year ? (
            <p className="text-xs text-on-surface-variant">
              {formatIsoDate(row.registration_start_date_for_year)} - {formatIsoDate(row.registration_end_date_for_year)}
            </p>
          ) : (
            <p className="text-xs text-on-surface-variant">—</p>
          )}
        </div>
      ),
    },
    {
      key: 'last-registration-year',
      header: 'Derniere annee',
      sortable: true,
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell min-w-[120px]',
      cell: (row) => <span className="text-sm text-on-surface">{row.last_registration_year ?? '—'}</span>,
    },
    {
      key: 'commission',
      header: 'Commission',
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell min-w-[100px]',
      cell: (row) => <CommissionBadge committeeCount={row.committee_count} />,
    },
  ]

  if (isLoading) {
    return (
      <div className="rounded-shape-md border border-outline-variant bg-surface p-8 text-center text-sm text-on-surface-variant">
        Chargement de l'annuaire…
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface">
      <DataTable
        columns={columns}
        data={visibleMembers}
        getRowKey={(row) => row.uuid}
        defaultSortKey="name"
        className={undefined}
        emptyState={
          <p className="p-8 text-center text-sm text-on-surface-variant">
            Aucun membre trouvé pour les filtres sélectionnés.
          </p>
        }
        actions={(row) => (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label={`Espace membre ${row.first_name} ${row.last_name}`}
              onClick={() => onOpenPilotSheet(row.uuid)}
              className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
              title="Espace membre"
            >
              <ScrollText className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={`Modifier ${row.first_name} ${row.last_name}`}
              onClick={() => onEditMember(row.uuid)}
              className={[
                'rounded p-1 transition-colors',
                selectedMemberId === row.uuid
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
              ].join(' ')}
            >
              <Pencil className="h-4 w-4" />
            </button>
            {allowRegistrationWorkflow ? (
              <KebabMenu
                items={[
                  {
                    label: "Finaliser l'inscription",
                    disabled: row.is_registered_for_year,
                    onClick: () => onFinalizeRegistration(row.uuid),
                  },
                ]}
              />
            ) : null}
          </div>
        )}
      />
      {/* Pagination footer */}
      <div className="flex items-center justify-between border-t border-outline-variant px-4 py-2 text-xs text-on-surface-variant">
        <span>
          {members.length === 0
            ? 'Aucun membre'
            : `${pageStart + 1}–${pageEnd} sur ${members.length} membre${members.length > 1 ? 's' : ''}`}
        </span>
        {totalPages > 1 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded px-2 py-1 transition-colors hover:bg-surface-container disabled:opacity-40"
              aria-label="Page précédente"
            >
              ‹
            </button>
            <span className="px-1">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded px-2 py-1 transition-colors hover:bg-surface-container disabled:opacity-40"
              aria-label="Page suivante"
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
