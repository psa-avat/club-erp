/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - rh: TypeScript types for the HR module
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

export type ContractType = 'CDI' | 'CDD' | 'SAISONNIER' | 'VACATAIRE' | 'BENEVOLE'

export interface HrEmployeeProfile {
  member_uuid: string
  user_id: number | null
  contract_type: ContractType
  hire_date: string
  termination_date: string | null
  weekly_hours: string
  annual_work_hours: string
  current_leave_balance: string
  last_leave_balance_update: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  member_first_name: string | null
  member_last_name: string | null
  member_account_id: string | null
  member_trigram: string | null
}

export interface HrSeason {
  uuid: string
  name: string
  start_date: string
  end_date: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface HrWorkCalendarDay {
  uuid: string
  day_of_week: number
  is_working: boolean
  expected_hours: string
  start_time: string | null
  end_time: string | null
  apply_on_week: number
}

/** Payload type for creating/updating calendar days (no uuid required) */
export interface HrWorkCalendarDayInput {
  day_of_week: number
  is_working: boolean
  expected_hours: string
  start_time: string | null
  end_time: string | null
  apply_on_week: number
}

export interface HrWorkCalendarInput {
  name: string
  description?: string | null
  days: HrWorkCalendarDayInput[]
}

export interface HrWorkCalendar {
  uuid: string
  name: string
  description: string | null
  days: HrWorkCalendarDay[]
  created_at: string
  updated_at: string
}

export interface HrCalendarAssignment {
  uuid: string
  member_uuid: string
  season_uuid: string
  calendar_uuid: string
  created_at: string
  member_first_name: string | null
  member_last_name: string | null
  member_account_id: string | null
  season_name: string | null
  calendar_name: string | null
}

export interface ExpectedHoursResult {
  date: string
  is_working: boolean
  expected_hours: string
  season_uuid: string | null
  season_name: string | null
  calendar_name: string | null
}

export interface WorkSummaryResponse {
  member_uuid: string
  start_date: string
  end_date: string
  total_expected_hours: string
  worked_days: number
  days: ExpectedHoursResult[]
}
