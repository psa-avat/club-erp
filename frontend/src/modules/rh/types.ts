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

// ---------------------------------------------------------------------------
// Employee profiles
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Working time calendars
// ---------------------------------------------------------------------------

export interface HrPhaseDayRuleInput {
  day_of_week: number        // 1=Mon … 7=Sun
  is_working: boolean
  expected_hours: string     // decimal string e.g. "7.00"
  start_time: string | null  // "HH:MM"
  end_time: string | null
  apply_on_week: number      // 0=every week, 1-5=Nth occurrence
}

export interface HrPhaseDayRule extends HrPhaseDayRuleInput {
  uuid: string
}

export interface HrCalendarPhaseInput {
  name: string
  start_month: number   // 1-12
  start_day: number     // 1-31
  end_month: number
  end_day: number
  day_rules: HrPhaseDayRuleInput[]
}

export interface HrCalendarPhase {
  uuid: string
  calendar_uuid: string
  name: string
  start_month: number
  start_day: number
  end_month: number
  end_day: number
  day_rules: HrPhaseDayRule[]
  created_at: string
  updated_at: string
}

export interface HrWorkingTimeCalendar {
  uuid: string
  name: string
  description: string | null
  phases: HrCalendarPhase[]
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Employee calendar assignments
// ---------------------------------------------------------------------------

export interface HrEmployeeCalendarAssignment {
  uuid: string
  member_uuid: string
  calendar_uuid: string
  effective_from: string   // ISO date
  effective_to: string | null
  created_at: string
  updated_at: string
  member_first_name: string | null
  member_last_name: string | null
  member_account_id: string | null
  calendar_name: string | null
}

// ---------------------------------------------------------------------------
// Calendar resolution
// ---------------------------------------------------------------------------

export interface ExpectedHoursResult {
  date: string
  is_working: boolean
  expected_hours: string
  phase_uuid: string | null
  phase_name: string | null
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
