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
import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { ImportDialog } from '../../../components/ui/ImportDialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { PageHeader } from '../../../components/ui/page-header'
import {
  exportMembersToCSV,
  useImportMembersMutation,
  useMembersCountQuery,
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
import type { MembersScreen } from '../types'

const MEMBERS_SCREEN_SET = new Set<MembersScreen>(['core', 'external', 'business'])

const SCREEN_META: Record<MembersScreen, { titleKey: string; descriptionKey: string }> = {
  core: {
    titleKey: 'list.screenMeta.core.title',
    descriptionKey: 'list.screenMeta.core.description',
  },
  external: {
    titleKey: 'list.screenMeta.external.title',
    descriptionKey: 'list.screenMeta.external.description',
  },
  business: {
    titleKey: 'list.screenMeta.business.title',
    descriptionKey: 'list.screenMeta.business.description',
  },
}

const SCREEN_CATEGORY_MAP: Record<MembersScreen, number[]> = {
  core: [1, 2, 3, 4, 6],
  external: [5, 7],
  business: [8],
}

const SCREEN_CATEGORY_LABEL_KEYS: Record<number, string> = {
  1: 'categories.full',
  2: 'categories.temporary',
  3: 'categories.nonFlying',
  4: 'categories.shortPeriod',
  5: 'categories.externalPilot',
  6: 'categories.volunteer',
  7: 'categories.externalOrganization',
  8: 'categories.clientSupplier',
}

function screenTabClass(isActive: boolean) {
  return [
    'rounded-shape-sm border px-3 py-1.5 text-xs font-medium transition-colors',
    isActive
      ? 'border-primary bg-primary text-on-primary'
      : 'border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container',
  ].join(' ')
}

export function MembersListPage() {
  const { t } = useTranslation('members')
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const { screen } = useParams<{ screen: string }>()
  const { selectedMemberId, setSelectedMemberId, selectedYear, filters, setFilters } = useMembersStore()

  const activeScreen: MembersScreen = MEMBERS_SCREEN_SET.has((screen ?? 'core') as MembersScreen)
    ? (screen as MembersScreen)
    : 'core'

  const [showImportDialog, setShowImportDialog] = useState(false)
  const [registrationPanelOpen, setRegistrationPanelOpen] = useState(false)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const PAGE_SIZE = 50

  const screenCategories = SCREEN_CATEGORY_MAP[activeScreen]
  const allowRegistrationWorkflow = activeScreen !== 'business'
  const screenCategoryLabels = useMemo(
    () => screenCategories.map((category) => t(SCREEN_CATEGORY_LABEL_KEYS[category])),
    [screenCategories, t],
  )
  const activeScreenMeta = SCREEN_META[activeScreen]

  const scopedFilters = useMemo(
    () => ({
      ...filters,
      member_categories: screenCategories,
      member_category:
        filters.member_category !== undefined && screenCategories.includes(filters.member_category)
          ? filters.member_category
          : undefined,
    }),
    [filters, screenCategories],
  )

  const countFilters = useMemo(() => {
    const { limit, offset, ...rest } = scopedFilters
    return rest
  }, [scopedFilters])

  const pagedFilters = useMemo(
    () => ({ ...countFilters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [countFilters, page],
  )

  const membersQuery = useMembersQuery(pagedFilters)
  const membersCountQuery = useMembersCountQuery(countFilters)
  const memberDetailQuery = useMemberQuery(selectedMemberId)
  const importMembersMutation = useImportMembersMutation()

  const members = membersQuery.data ?? []
  const totalMembers = membersCountQuery.data ?? 0
  const totalPages = Math.max(1, Math.ceil(totalMembers / PAGE_SIZE))
  const selectedMember = memberDetailQuery.data ?? null

  useEffect(() => {
    if (!screen || !MEMBERS_SCREEN_SET.has(screen as MembersScreen)) {
      navigate('/club/members/core', { replace: true })
    }
  }, [screen, navigate])

  useEffect(() => {
    if (filters.member_category !== undefined && !screenCategories.includes(filters.member_category)) {
      setFilters({ ...filters, member_category: undefined })
    }
  }, [filters, screenCategories, setFilters])

  useEffect(() => {
    setPage(0)
  }, [countFilters])

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1))
    }
  }, [page, totalPages])

  function handleNewMember() {
    setRegistrationPanelOpen(false)
    setSelectedMemberId(null)
    navigate('/club/members/new')
  }

  function handleOpenRegistrationPanel(memberUuid?: string) {
    if (!allowRegistrationWorkflow) {
      return
    }

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

  function handleOpenPilotSheet(memberUuid: string) {
    navigate(`/club/members/${memberUuid}/pilot-sheet`)
  }

  async function handleExportMembers() {
    try {
      setIsExporting(true)
      setExportError(null)
      await exportMembersToCSV({
        status: scopedFilters.status,
        member_category: scopedFilters.member_category,
        search: scopedFilters.search,
      })
    } catch (error) {
      setExportError(toErrorMessage(error))
    } finally {
      setIsExporting(false)
    }
  }

  const combinedError =
    membersQuery.error ??
    membersCountQuery.error ??
    memberDetailQuery.error

  return (
    <ClubPageShell>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <PageHeader
        title={t('list.title')}
        supportingText={`${t(activeScreenMeta.titleKey)}: ${t(activeScreenMeta.descriptionKey)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button 
              type="button" 
              variant="secondary" 
              onClick={handleExportMembers}
              disabled={isExporting}
            >
              {isExporting ? tCommon('export.exporting') : tCommon('export.button')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowImportDialog(true)}>
              {tCommon('import.button')}
            </Button>
            <Button type="button" onClick={handleNewMember}>
              {t('actions.newMember')}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap gap-2">
            <NavLink to="/club/members/core" className={({ isActive }) => screenTabClass(isActive)}>
              {t('list.screenTabs.core')}
            </NavLink>
            <NavLink to="/club/members/external" className={({ isActive }) => screenTabClass(isActive)}>
              {t('list.screenTabs.external')}
            </NavLink>
            <NavLink to="/club/members/business" className={({ isActive }) => screenTabClass(isActive)}>
              {t('list.screenTabs.business')}
            </NavLink>
          </div>
          <p className="text-xs text-on-surface-variant">
            <span className="font-medium text-on-surface">{t(activeScreenMeta.titleKey)}:</span>{' '}
            {t(activeScreenMeta.descriptionKey)}
          </p>
          <p className="text-xs text-on-surface-variant">
            <span className="font-medium text-on-surface">{t('list.includedCategories')}:</span>{' '}
            {screenCategoryLabels.join(', ')}
          </p>
        </CardContent>
      </Card>

      {/* ── KPI strip ────────────────────────────────────────────────── */}
      <MemberKpiStrip members={members} selectedYear={selectedYear} screen={activeScreen} />

      {/* ── Error banner ─────────────────────────────────────────────── */}
      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}
      {exportError ? <Alert>{exportError}</Alert> : null}

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
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setFilters({
                  ...filters,
                  status: filters.status === 1 ? undefined : 1,
                })
              }
            >
              {filters.status === 1 ? t('list.showAllMembers') : t('list.showActiveOnly')}
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
              ...screenCategories.map((category) => ({
                value: String(category),
                label: t(SCREEN_CATEGORY_LABEL_KEYS[category]),
              })),
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
              { value: '3', label: t('statuses.anonymized') },
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
        allowRegistrationWorkflow={allowRegistrationWorkflow}
        onEditMember={handleEditMember}
        onFinalizeRegistration={handleFinalizeRegistration}
        onOpenPilotSheet={handleOpenPilotSheet}
      />

      {totalMembers > PAGE_SIZE ? (
        <div className="flex items-center justify-between rounded-shape-md border border-outline-variant bg-surface px-4 py-3">
          <p className="text-sm text-on-surface-variant">
            {t('list.paginationSummary', {
              start: page * PAGE_SIZE + 1,
              end: Math.min((page + 1) * PAGE_SIZE, totalMembers),
              total: totalMembers,
              page: page + 1,
              pages: totalPages,
            })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

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
        allowWorkflow={allowRegistrationWorkflow}
        onCompleted={(memberUuid) => {
          setSelectedMemberId(memberUuid)
          setRegistrationPanelOpen(false)
        }}
      />

      <MemberFilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        filters={filters}
        screenTitle={t(activeScreenMeta.titleKey)}
        screenCategoryLabels={screenCategoryLabels}
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

