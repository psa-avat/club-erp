/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - rh: TanStack Query hooks for the HR module API
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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type {
  HrCalendarPhaseInput,
  HrEmployeeCalendarAssignment,
  HrEmployeeProfile,
  HrWorkingTimeCalendar,
  WorkSummaryResponse,
} from '../types'

export const hrQueryKeys = {
  profiles: ['hr', 'profiles'] as const,
  profile: (memberUuid: string) => ['hr', 'profiles', memberUuid] as const,
  calendars: ['hr', 'calendars'] as const,
  calendar: (uuid: string) => ['hr', 'calendars', uuid] as const,
  assignments: (memberUuid?: string) => ['hr', 'assignments', memberUuid] as const,
}

// ---------------------------------------------------------------------------
// Employee profiles
// ---------------------------------------------------------------------------

export function useHrProfiles(activeOnly = true) {
  return useQuery({
    queryKey: hrQueryKeys.profiles,
    queryFn: async () => {
      const r = await apiClient.get<HrEmployeeProfile[]>('/api/v1/hr/profiles', {
        params: { active_only: activeOnly },
      })
      return r.data
    },
  })
}

export function useHrProfile(memberUuid: string) {
  return useQuery({
    queryKey: hrQueryKeys.profile(memberUuid),
    queryFn: async () => {
      const r = await apiClient.get<HrEmployeeProfile>(`/api/v1/hr/profiles/${memberUuid}`)
      return r.data
    },
    enabled: !!memberUuid,
  })
}

export function useCreateHrProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Partial<HrEmployeeProfile>) => {
      const r = await apiClient.post<HrEmployeeProfile>('/api/v1/hr/profiles', data)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.profiles }),
  })
}

export function useUpdateHrProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      memberUuid,
      data,
    }: {
      memberUuid: string
      data: Partial<HrEmployeeProfile>
    }) => {
      const r = await apiClient.patch<HrEmployeeProfile>(`/api/v1/hr/profiles/${memberUuid}`, data)
      return r.data
    },
    onSuccess: (_, { memberUuid }) => {
      qc.invalidateQueries({ queryKey: hrQueryKeys.profiles })
      qc.invalidateQueries({ queryKey: hrQueryKeys.profile(memberUuid) })
    },
  })
}

// ---------------------------------------------------------------------------
// Working time calendars
// ---------------------------------------------------------------------------

export function useHrCalendars() {
  return useQuery({
    queryKey: hrQueryKeys.calendars,
    queryFn: async () => {
      const r = await apiClient.get<HrWorkingTimeCalendar[]>('/api/v1/hr/calendars')
      return r.data
    },
  })
}

export function useCreateHrCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { name: string; description?: string | null }) => {
      const r = await apiClient.post<HrWorkingTimeCalendar>('/api/v1/hr/calendars', data)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.calendars }),
  })
}

export function useUpdateHrCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      uuid,
      data,
    }: {
      uuid: string
      data: { name?: string; description?: string | null }
    }) => {
      const r = await apiClient.patch<HrWorkingTimeCalendar>(`/api/v1/hr/calendars/${uuid}`, data)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.calendars }),
  })
}

export function useDeleteHrCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (uuid: string) => apiClient.delete(`/api/v1/hr/calendars/${uuid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.calendars }),
  })
}

// ---------------------------------------------------------------------------
// Phases (nested under a calendar)
// ---------------------------------------------------------------------------

export function useCreateHrPhase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      calendarUuid,
      data,
    }: {
      calendarUuid: string
      data: HrCalendarPhaseInput
    }) => {
      const r = await apiClient.post(
        `/api/v1/hr/calendars/${calendarUuid}/phases`,
        data,
      )
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.calendars }),
  })
}

export function useUpdateHrPhase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      calendarUuid,
      phaseUuid,
      data,
    }: {
      calendarUuid: string
      phaseUuid: string
      data: Partial<HrCalendarPhaseInput>
    }) => {
      const r = await apiClient.patch(
        `/api/v1/hr/calendars/${calendarUuid}/phases/${phaseUuid}`,
        data,
      )
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.calendars }),
  })
}

export function useDeleteHrPhase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      calendarUuid,
      phaseUuid,
    }: {
      calendarUuid: string
      phaseUuid: string
    }) => apiClient.delete(`/api/v1/hr/calendars/${calendarUuid}/phases/${phaseUuid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.calendars }),
  })
}

// ---------------------------------------------------------------------------
// Employee calendar assignments
// ---------------------------------------------------------------------------

export function useHrAssignments(memberUuid?: string) {
  return useQuery({
    queryKey: hrQueryKeys.assignments(memberUuid),
    queryFn: async () => {
      const r = await apiClient.get<HrEmployeeCalendarAssignment[]>(
        '/api/v1/hr/calendar-assignments',
        { params: memberUuid ? { member_uuid: memberUuid } : undefined },
      )
      return r.data
    },
  })
}

export function useCreateHrAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: {
      member_uuid: string
      calendar_uuid: string
      effective_from: string
      effective_to?: string | null
    }) => {
      const r = await apiClient.post<HrEmployeeCalendarAssignment>(
        '/api/v1/hr/calendar-assignments',
        data,
      )
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'assignments'] }),
  })
}

export function useUpdateHrAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      uuid,
      data,
    }: {
      uuid: string
      data: {
        calendar_uuid?: string
        effective_from?: string
        effective_to?: string | null
      }
    }) => {
      const r = await apiClient.patch<HrEmployeeCalendarAssignment>(
        `/api/v1/hr/calendar-assignments/${uuid}`,
        data,
      )
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'assignments'] }),
  })
}

export function useDeleteHrAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (uuid: string) =>
      apiClient.delete(`/api/v1/hr/calendar-assignments/${uuid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'assignments'] }),
  })
}

// ---------------------------------------------------------------------------
// Work summary
// ---------------------------------------------------------------------------

export function useWorkSummary(
  memberUuid: string,
  startDate: string,
  endDate: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['hr', 'work-summary', memberUuid, startDate, endDate],
    queryFn: async () => {
      const r = await apiClient.get<WorkSummaryResponse>('/api/v1/hr/calendar/work-summary', {
        params: { member_uuid: memberUuid, start_date: startDate, end_date: endDate },
      })
      return r.data
    },
    enabled: enabled && !!memberUuid && !!startDate && !!endDate,
  })
}
