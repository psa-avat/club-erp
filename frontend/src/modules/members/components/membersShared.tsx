/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Shared helpers, form types, and UI primitives for the club module
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
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import type {
  Committee,
  CreateCommitteePayload,
  CreateMemberPayload,
  MemberDetail,
  MemberSheet,
  UpdateCommitteePayload,
  UpdateMemberPayload,
  UpsertMemberSheetPayload,
} from '../types'

// ---------------------------------------------------------------------------
// Form state types
// ---------------------------------------------------------------------------

export type MemberFormState = {
  genre: string
  first_name: string
  last_name: string
  date_of_birth: string
  email: string
  phone: string
  member_category: string
  seniority: string
  ffvp_id: string
  account_id: string
  photo_url: string
  is_active: boolean
  status: string
  registration_status: string
  is_instructor: boolean
  is_employee: boolean
  is_executive: boolean
  is_board_member: boolean
  can_fly: boolean
  external_auth_enabled: boolean
  notes: string
}

export type CommitteeFormState = {
  code: string
  description: string
  budget_amount: string
  manager_member_uuid: string
  is_active: boolean
}

export type SheetFormState = {
  licence_number: string
  fare_type: string
  hours_count: string
  packs_bought_count: string
  hours_done_in_pack: string
  remaining_hours_in_pack: string
  expense_access_enabled: boolean
}

// ---------------------------------------------------------------------------
// Form initializers / mappers
// ---------------------------------------------------------------------------

export function createEmptyMemberForm(): MemberFormState {
  return {
    genre: '0',
    first_name: '',
    last_name: '',
    date_of_birth: '',
    email: '',
    phone: '',
    member_category: '1',
    seniority: '',
    ffvp_id: '',
    account_id: '',
    photo_url: '',
    is_active: true,
    status: '1',
    registration_status: '1',
    is_instructor: false,
    is_employee: false,
    is_executive: false,
    is_board_member: false,
    can_fly: true,
    external_auth_enabled: false,
    notes: '',
  }
}

export function createCommitteeForm(committee?: Committee | null): CommitteeFormState {
  return {
    code: committee?.code ?? '',
    description: committee?.description ?? '',
    budget_amount: committee?.budget_amount ?? '',
    manager_member_uuid: committee?.manager_member_uuid ?? '',
    is_active: committee?.is_active ?? true,
  }
}

export function createSheetForm(sheet?: MemberSheet | null): SheetFormState {
  return {
    licence_number: sheet?.licence_number ?? '',
    fare_type: String(sheet?.fare_type ?? 1),
    hours_count: sheet?.hours_count ?? '0',
    packs_bought_count: String(sheet?.packs_bought_count ?? 0),
    hours_done_in_pack: sheet?.hours_done_in_pack ?? '0',
    remaining_hours_in_pack: sheet?.remaining_hours_in_pack ?? '0',
    expense_access_enabled: sheet?.expense_access_enabled ?? false,
  }
}

export function mapMemberToForm(member: MemberDetail): MemberFormState {
  return {
    genre: String(member.genre),
    first_name: member.first_name,
    last_name: member.last_name,
    date_of_birth: member.date_of_birth ?? '',
    email: member.email ?? '',
    phone: member.phone ?? '',
    member_category: String(member.member_category),
    seniority: member.seniority === null ? '' : String(member.seniority),
    ffvp_id: member.ffvp_id === null ? '' : String(member.ffvp_id),
    account_id: member.account_id,
    photo_url: member.photo_url ?? '',
    is_active: member.is_active,
    status: String(member.status),
    registration_status: String(member.registration_status),
    is_instructor: member.is_instructor,
    is_employee: member.is_employee,
    is_executive: member.is_executive,
    is_board_member: member.is_board_member,
    can_fly: member.can_fly,
    external_auth_enabled: member.external_auth_enabled,
    notes: member.notes ?? '',
  }
}

export function buildMemberPayload(form: MemberFormState): CreateMemberPayload {
  return {
    genre: Number(form.genre),
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    ...(form.date_of_birth ? { date_of_birth: form.date_of_birth } : {}),
    ...(form.email.trim() ? { email: form.email.trim() } : {}),
    ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
    member_category: Number(form.member_category),
    ...(form.seniority ? { seniority: Number(form.seniority) } : {}),
    ...(form.ffvp_id ? { ffvp_id: Number(form.ffvp_id) } : {}),
    ...(form.account_id.trim() ? { account_id: form.account_id.trim() } : {}),
    ...(form.photo_url.trim() ? { photo_url: form.photo_url.trim() } : {}),
    is_active: form.is_active,
    status: Number(form.status),
    registration_status: Number(form.registration_status),
    is_instructor: form.is_instructor,
    is_employee: form.is_employee,
    is_executive: form.is_executive,
    is_board_member: form.is_board_member,
    can_fly: form.can_fly,
    external_auth_enabled: form.external_auth_enabled,
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
  }
}

export function buildCommitteePayload(form: CommitteeFormState): CreateCommitteePayload {
  return {
    code: form.code.trim(),
    description: form.description.trim(),
    ...(form.budget_amount.trim() ? { budget_amount: form.budget_amount.trim() } : {}),
    ...(form.manager_member_uuid ? { manager_member_uuid: form.manager_member_uuid } : {}),
    is_active: form.is_active,
  }
}

export function buildSheetPayload(form: SheetFormState): UpsertMemberSheetPayload {
  return {
    ...(form.licence_number.trim() ? { licence_number: form.licence_number.trim() } : {}),
    fare_type: Number(form.fare_type),
    hours_count: form.hours_count || '0',
    packs_bought_count: Number(form.packs_bought_count || 0),
    hours_done_in_pack: form.hours_done_in_pack || '0',
    remaining_hours_in_pack: form.remaining_hours_in_pack || '0',
    expense_access_enabled: form.expense_access_enabled,
  }
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export function memberCategoryLabel(category: number) {
  const map: Record<number, string> = {
    1: 'Full',
    2: 'Temporary',
    3: 'Non-flying',
    4: 'Short period',
    5: 'External pilot',
    6: 'Volunteer',
  }
  return map[category] ?? `#${category}`
}

export function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: string } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'string' && detail.length > 0) return detail

    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string }
      if (typeof first?.msg === 'string' && first.msg.length > 0) return first.msg
    }

    if (typeof response?.data?.message === 'string' && response.data.message.length > 0) {
      return response.data.message
    }
  }
  return 'Unexpected error'
}

// ---------------------------------------------------------------------------
// Shared form primitives
// ---------------------------------------------------------------------------

export function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="h-10 w-full rounded-shape-sm border border-outline bg-surface px-3 text-sm text-on-surface shadow-sm outline-none focus:border-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={`${id}-${option.value || 'empty'}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-on-surface-variant">
      <input checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

export function Pill({ active, children }: { active: boolean; children: string }) {
  if (!active) return null
  return (
    <span className="rounded-full bg-primary-container px-2 py-1 text-xs font-medium text-on-surface-variant">
      {children}
    </span>
  )
}

// UpdateMemberPayload re-export for convenience
export type { UpdateMemberPayload, UpdateCommitteePayload }
