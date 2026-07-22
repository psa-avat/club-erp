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

import { useEffect, useState } from 'react'
import { ClipboardCheck, Pencil, ScrollText } from 'lucide-react'

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
  onOpenLogbook?: (uuid: string) => void
  onOpenBalance?: (uuid: string) => void
  /** Present to enable a leading checkbox column for bulk selection (e.g. recap emails). */
  selectedForBulk?: Set<string>
  onToggleSelectedForBulk?: (uuid: string) => void
  onToggleSelectAllForBulk?: (uuids: string[]) => void
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
  onOpenLogbook,
  onOpenBalance,
  selectedForBulk,
  onToggleSelectedForBulk,
  onToggleSelectAllForBulk,
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
  const bulkSelectionEnabled = selectedForBulk !== undefined && onToggleSelectedForBulk !== undefined
  const visibleIds = visibleMembers.map((row) => row.uuid)
  const allVisibleSelected =
    bulkSelectionEnabled && visibleIds.length > 0 && visibleIds.every((uuid) => selectedForBulk!.has(uuid))
  const columns: ColumnDef<MemberSummary>[] = [
    ...(bulkSelectionEnabled
      ? [
          {
            key: 'select',
            header: (
              <input
                type="checkbox"
                aria-label="Sélectionner tous les membres visibles"
                checked={allVisibleSelected}
                onChange={() => onToggleSelectAllForBulk?.(visibleIds)}
              />
            ),
            className: 'w-8',
            cell: (row: MemberSummary) => (
              <input
                type="checkbox"
                aria-label={`Sélectionner ${row.first_name} ${row.last_name}`}
                checked={selectedForBulk!.has(row.uuid)}
                onChange={() => onToggleSelectedForBulk?.(row.uuid)}
                onClick={(event) => event.stopPropagation()}
              />
            ),
          } satisfies ColumnDef<MemberSummary>,
        ]
      : []),
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
                <span className="truncate font-medium text-foreground">
                  {row.first_name} {row.last_name}
                </span>
                {needsRenewal ? <RenewalWarningIcon /> : null}
              </div>
              <span className="font-mono text-xs text-muted-foreground">
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
        <span className="text-sm text-foreground">{memberCategoryLabel(row.member_category)}</span>
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
            <p className="text-xs text-muted-foreground">
              {formatIsoDate(row.registration_start_date_for_year)} - {formatIsoDate(row.registration_end_date_for_year)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">—</p>
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
      cell: (row) => <span className="text-sm text-foreground">{row.last_registration_year ?? '—'}</span>,
    },
    {
      key: 'commission',
      header: 'Commission',
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell min-w-[100px]',
      cell: (row) => <CommissionBadge committeeCount={row.committee_count} />,
    },
    {
      key: 'last-flight',
      header: 'Dernier vol',
      sortable: true,
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell min-w-[110px]',
      cell: (row) => {
        if (!row.last_flight_date) return <span className="text-sm text-slate-400">—</span>;
        const fd = new Date(row.last_flight_date);
        const label = Number.isNaN(fd.getTime()) ? row.last_flight_date : fd.toLocaleDateString('fr-FR');
        return (
          <button
            type="button"
            onClick={() => onOpenLogbook?.(row.uuid)}
            className="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
            title="Voir le carnet de vol"
          >
            {label}
          </button>
        );
      },
    },
    {
      key: 'balance',
      header: 'Solde',
      sortable: true,
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell min-w-[110px] font-mono text-sm',
      cell: (row) => {
        if (row.balance === null || row.balance === undefined) return <span className="text-slate-400">—</span>;
        const num = Number(row.balance);
        if (!Number.isFinite(num)) return <span className="text-slate-400">{String(row.balance)}</span>;
        const formatted = num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const isNegative = num < 0;
        return (
          <button
            type="button"
            onClick={() => onOpenBalance?.(row.uuid)}
            className={`transition-colors hover:underline ${
              isNegative ? 'text-red-600 hover:text-red-800' : 'text-emerald-600 hover:text-emerald-800'
            }`}
            title="Voir le solde du compte"
          >
            {isNegative ? '−' : ''}{formatted} €
          </button>
        );
      },
    },
  ]

  if (isLoading) {
    return (
      <div className="rounded-md border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Chargement de l'annuaire…
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <DataTable
        columns={columns}
        data={visibleMembers}
        getRowKey={(row) => row.uuid}
        defaultSortKey="name"
        className={undefined}
        emptyState={
          <p className="p-8 text-center text-sm text-muted-foreground">
            Aucun membre trouvé pour les filtres sélectionnés.
          </p>
        }
        actions={(row) => (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label={`Espace membre ${row.first_name} ${row.last_name}`}
              onClick={() => onOpenPilotSheet(row.uuid)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
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
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              ].join(' ')}
            >
              <Pencil className="h-4 w-4" />
            </button>
            {allowRegistrationWorkflow ? (
              <button
                type="button"
                aria-label={`Finaliser l'inscription de ${row.first_name} ${row.last_name}`}
                title="Finaliser l'inscription"
                disabled={row.is_registered_for_year}
                onClick={() => onFinalizeRegistration(row.uuid)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ClipboardCheck className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        )}
      />
      {/* Pagination footer */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
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
              className="rounded px-2 py-1 transition-colors hover:bg-muted disabled:opacity-40"
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
              className="rounded px-2 py-1 transition-colors hover:bg-muted disabled:opacity-40"
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
