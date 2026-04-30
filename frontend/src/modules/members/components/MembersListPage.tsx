/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Members directory page — table, KPI strip, filters, and edit form
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
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { ImportDialog } from '../../../components/ui/ImportDialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { PageHeader } from '../../../components/ui/page-header'
import {
  useImportMembersMutation,
  useMemberQuery,
  useMembersQuery,
} from '../api'
import { useMembersStore } from '../store'
import {
  SelectField,
  toErrorMessage,
} from './membersShared'
import { ClubPageShell } from './ClubPageShell'
import { MemberDirectoryTable } from './MemberDirectoryTable'
import { MemberFilterDrawer } from './MemberFilterDrawer'
import { MemberKpiStrip } from './MemberKpiStrip'
import { RegistrationPanel } from './RegistrationPanel'

export function MembersListPage() {
  const { t } = useTranslation('members')
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const { selectedMemberId, setSelectedMemberId, selectedYear, filters, setFilters } = useMembersStore()

  const [showImportDialog, setShowImportDialog] = useState(false)
  const [registrationPanelOpen, setRegistrationPanelOpen] = useState(false)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)

  const membersQuery = useMembersQuery(filters)
  const memberDetailQuery = useMemberQuery(selectedMemberId)
  const importMembersMutation = useImportMembersMutation()

  const members = membersQuery.data ?? []
  const selectedMember = memberDetailQuery.data ?? null

  function handleNewMember() {
    setRegistrationPanelOpen(false)
    setSelectedMemberId(null)
    navigate('/club/members/new')
  }

  function handleOpenRegistrationPanel(memberUuid?: string) {
    if (memberUuid) {
      setSelectedMemberId(memberUuid)
    }
    setRegistrationPanelOpen(true)
  }

  function handleFinalizeRegistration(memberUuid: string) {
    handleOpenRegistrationPanel(memberUuid)
  }

  function handleEditMember(memberUuid: string) {
    setSelectedMemberId(memberUuid)
    navigate(`/club/members/${memberUuid}/edit`)
  }

  const combinedError =
    membersQuery.error ??
    memberDetailQuery.error

  return (
    <ClubPageShell>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <PageHeader
        title={t('list.title')}
        supportingText="Gérez les membres du club, leurs certifications et leur statut opérationnel."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowImportDialog(true)}>
              {tCommon('import.button')}
            </Button>
            <Button type="button" onClick={handleNewMember}>
              {t('actions.newMember')}
            </Button>
          </div>
        }
      />

      {/* ── KPI strip ────────────────────────────────────────────────── */}
      <MemberKpiStrip members={members} selectedYear={selectedYear} />

      {/* ── Error banner ─────────────────────────────────────────────── */}
      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>{t('filters.title')}</CardTitle>
              <CardDescription>{t('filters.description')}</CardDescription>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFilterDrawerOpen(true)}
            >
              {t('filters.advancedButton')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="members-search">{t('filters.search')}</Label>
            <Input
              id="members-search"
              placeholder={t('filters.searchPlaceholder')}
              value={filters.search ?? ''}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </div>
          <SelectField
            id="members-category-filter"
            label={t('filters.category')}
            options={[
              { value: '', label: t('filters.all') },
              { value: '1', label: t('categories.full') },
              { value: '2', label: t('categories.temporary') },
              { value: '3', label: t('categories.nonFlying') },
              { value: '4', label: t('categories.shortPeriod') },
              { value: '5', label: t('categories.externalPilot') },
              { value: '6', label: t('categories.volunteer') },
            ]}
            value={filters.member_category ? String(filters.member_category) : ''}
            onChange={(value) =>
              setFilters({ ...filters, member_category: value ? Number(value) : undefined })
            }
          />
          <SelectField
            id="members-status-filter"
            label={t('filters.status')}
            options={[
              { value: '', label: t('filters.all') },
              { value: '1', label: t('statuses.active') },
              { value: '2', label: t('statuses.suspended') },
              { value: '3', label: t('statuses.resigned') },
              { value: '4', label: t('statuses.anonymized') },
            ]}
            value={filters.status ? String(filters.status) : ''}
            onChange={(value) =>
              setFilters({ ...filters, status: value ? Number(value) : undefined })
            }
          />
          <SelectField
            id="members-can-fly-filter"
            label={t('filters.canFly')}
            options={[
              { value: '', label: t('filters.all') },
              { value: 'true', label: t('filters.onlyFlying') },
              { value: 'false', label: t('filters.onlyGround') },
            ]}
            value={filters.can_fly === undefined ? '' : String(filters.can_fly)}
            onChange={(value) =>
              setFilters({ ...filters, can_fly: value ? value === 'true' : undefined })
            }
          />
        </CardContent>
      </Card>

      {/* ── Directory table ──────────────────────────────────────────── */}
      <MemberDirectoryTable
        members={members}
        isLoading={membersQuery.isLoading}
        selectedMemberId={selectedMemberId}
        selectedYear={selectedYear}
        onEditMember={handleEditMember}
        onFinalizeRegistration={handleFinalizeRegistration}
      />

      {/* ── Directory legend ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500" /> Actif — pleinement opérationnel
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" /> Suspendu — accès vol révoqué
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 text-orange-500">⚠</span> Renouvellement requis
        </span>
      </div>

      <RegistrationPanel
        open={registrationPanelOpen}
        onClose={() => setRegistrationPanelOpen(false)}
        member={selectedMember}
        year={selectedYear}
        onCompleted={(memberUuid) => {
          setSelectedMemberId(memberUuid)
          setRegistrationPanelOpen(false)
        }}
      />

      <MemberFilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        filters={filters}
        onApply={(newFilters) => setFilters(newFilters)}
      />

      {/* ── Import dialog ─────────────────────────────────────────────── */}
      {showImportDialog ? (
        <ImportDialog
          title={tCommon('import.button')}
          onUpload={(file, options) => importMembersMutation.mutateAsync({ file, updateExisting: options.updateExisting })}
          showUpdateExistingToggle
          sampleCsvHref="/samples/members-sample.csv"
          onClose={() => setShowImportDialog(false)}
        />
      ) : null}
    </ClubPageShell>
  )
}

