/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Advanced filter drawer for the Members Directory
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
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { Dialog } from '../../../components/ui/dialog'
import { Label } from '../../../components/ui/label'
import { useCommitteesQuery } from '../api'
import type { MemberFilters } from '../types'
import { CheckboxField, SelectField } from './membersShared'

type Props = {
  open: boolean
  onClose: () => void
  filters: MemberFilters
  screenTitle: string
  screenCategoryLabels: string[]
  onApply: (filters: MemberFilters) => void
}

export function MemberFilterDrawer({
  open,
  onClose,
  filters,
  screenTitle,
  screenCategoryLabels,
  onApply,
}: Props) {
  const { t } = useTranslation('members')

  const [draft, setDraft] = useState<MemberFilters>(() => ({ ...filters }))

  const committeesQuery = useCommitteesQuery()
  const committees = committeesQuery.data ?? []

  // Re-sync draft each time the drawer opens
  useEffect(() => {
    if (open) setDraft({ ...filters })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleApply() {
    onApply(draft)
    onClose()
  }

  function handleClear() {
    const cleared: MemberFilters = {
      search: filters.search,
      can_fly: filters.can_fly,
      member_category: filters.member_category,
      status: filters.status,
    }
    onApply(cleared)
    onClose()
  }

  const yearRequiredForState = draft.registration_state !== undefined && !draft.year

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="filter-drawer-title"
      className="ml-auto mr-0 flex h-[100vh] max-h-[100vh] w-full max-w-sm flex-col overflow-hidden rounded-none"
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b border-outline-variant px-6 py-4">
          <h2 id="filter-drawer-title" className="text-base font-semibold text-on-surface">
            {t('filters.advancedTitle')}
          </h2>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="rounded-shape-sm border border-outline-variant bg-surface-container px-3 py-2">
            <p className="text-xs font-medium text-on-surface">
              Scope: {screenTitle}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Categories: {screenCategoryLabels.join(', ')}
            </p>
          </section>

          {/* Registration section */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              {t('filters.registration')}
            </p>

            <SelectField
              id="filter-registration-status"
              label={t('form.registrationStatus')}
              options={[
                { value: '', label: t('filters.all') },
                { value: '1', label: t('registration.pending') },
                { value: '2', label: t('registration.completed') },
              ]}
              value={draft.registration_status !== undefined ? String(draft.registration_status) : ''}
              onChange={(value) =>
                setDraft({ ...draft, registration_status: value ? Number(value) : undefined })
              }
            />

            <div className="space-y-1.5">
              <Label htmlFor="filter-registration-state">{t('filters.registrationState')}</Label>
              <select
                id="filter-registration-state"
                value={draft.registration_state ?? ''}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    registration_state: (event.target.value as 'registered' | 'unregistered') || undefined,
                  })
                }
                className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
              >
                <option value="">{t('filters.allStates')}</option>
                <option value="registered">{t('filters.registrationStateRegistered')}</option>
                <option value="unregistered">{t('filters.registrationStateUnregistered')}</option>
              </select>
              {yearRequiredForState ? (
                <p className="text-xs text-amber-700">{t('filters.yearRequiredForState')}</p>
              ) : null}
            </div>
          </section>

          {/* Committee section */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              {t('filters.committee')}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="filter-committee">{t('filters.committee')}</Label>
              <select
                id="filter-committee"
                value={draft.committee_uuid ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, committee_uuid: event.target.value || undefined })
                }
                className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface"
              >
                <option value="">{t('filters.allCommittees')}</option>
                {committees.map((committee) => (
                  <option key={committee.uuid} value={committee.uuid}>
                    {committee.code} — {committee.description}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Member flags section */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              {t('filters.roleFlags')}
            </p>
            <div className="space-y-2">
              <CheckboxField
                label={t('filters.activeOnly')}
                checked={draft.status === 1}
                onChange={(checked) =>
                  setDraft({
                    ...draft,
                    status: checked ? 1 : undefined,
                  })
                }
              />
              <CheckboxField
                label={t('flags.instructor')}
                checked={draft.is_instructor === true}
                onChange={(checked) => setDraft({ ...draft, is_instructor: checked ? true : undefined })}
              />
              <CheckboxField
                label={t('flags.employee')}
                checked={draft.is_employee === true}
                onChange={(checked) => setDraft({ ...draft, is_employee: checked ? true : undefined })}
              />
              <CheckboxField
                label={t('flags.executive')}
                checked={draft.is_executive === true}
                onChange={(checked) => setDraft({ ...draft, is_executive: checked ? true : undefined })}
              />
              <CheckboxField
                label={t('flags.board')}
                checked={draft.is_board_member === true}
                onChange={(checked) => setDraft({ ...draft, is_board_member: checked ? true : undefined })}
              />
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant px-6 py-4">
          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={handleClear}>
              {t('filters.clear')}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t('registrationPanel.actions.cancel')}
              </Button>
              <Button type="button" onClick={handleApply} disabled={yearRequiredForState}>
                {t('filters.apply')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
