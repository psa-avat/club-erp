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
  HrCalendarAssignment,
  HrEmployeeProfile,
  HrSeason,
  HrWorkCalendar,
  HrWorkCalendarInput,
  WorkSummaryResponse,
} from '../types'

export const hrQueryKeys = {
  profiles: ['hr', 'profiles'] as const,
  profile: (memberUuid: string) => ['hr', 'profiles', memberUuid] as const,
  seasons: ['hr', 'seasons'] as const,
  season: (uuid: string) => ['hr', 'seasons', uuid] as const,
  calendars: ['hr', 'calendars'] as const,
  calendar: (uuid: string) => ['hr', 'calendars', uuid] as const,
  assignments: (memberUuid?: string) => ['hr', 'assignments', memberUuid] as const,
}

// --- Profiles ---
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

// --- Seasons ---
export function useHrSeasons() {
  return useQuery({
    queryKey: hrQueryKeys.seasons,
    queryFn: async () => {
      const r = await apiClient.get<HrSeason[]>('/api/v1/hr/seasons')
      return r.data
    },
  })
}

export function useCreateHrSeason() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Omit<HrSeason, 'uuid' | 'created_at' | 'updated_at'>) => {
      const r = await apiClient.post<HrSeason>('/api/v1/hr/seasons', data)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.seasons }),
  })
}

export function useUpdateHrSeason() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ uuid, data }: { uuid: string; data: Partial<HrSeason> }) => {
      const r = await apiClient.patch<HrSeason>(`/api/v1/hr/seasons/${uuid}`, data)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.seasons }),
  })
}

export function useDeleteHrSeason() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (uuid: string) => apiClient.delete(`/api/v1/hr/seasons/${uuid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.seasons }),
  })
}

// --- Calendars ---
export function useHrCalendars() {
  return useQuery({
    queryKey: hrQueryKeys.calendars,
    queryFn: async () => {
      const r = await apiClient.get<HrWorkCalendar[]>('/api/v1/hr/calendars')
      return r.data
    },
  })
}

export function useCreateHrCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: HrWorkCalendarInput) => {
      const r = await apiClient.post<HrWorkCalendar>('/api/v1/hr/calendars', data)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: hrQueryKeys.calendars }),
  })
}

export function useUpdateHrCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ uuid, data }: { uuid: string; data: HrWorkCalendarInput }) => {
      const r = await apiClient.patch<HrWorkCalendar>(`/api/v1/hr/calendars/${uuid}`, data)
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

// --- Assignments ---
export function useHrAssignments(memberUuid?: string) {
  return useQuery({
    queryKey: hrQueryKeys.assignments(memberUuid),
    queryFn: async () => {
      const r = await apiClient.get<HrCalendarAssignment[]>('/api/v1/hr/calendar-assignments', {
        params: memberUuid ? { member_uuid: memberUuid } : undefined,
      })
      return r.data
    },
  })
}

export function useCreateHrAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: {
      member_uuid: string
      season_uuid: string
      calendar_uuid: string
    }) => {
      const r = await apiClient.post<HrCalendarAssignment>('/api/v1/hr/calendar-assignments', data)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'assignments'] }),
  })
}

export function useUpdateHrAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ uuid, calendar_uuid }: { uuid: string; calendar_uuid: string }) => {
      const r = await apiClient.patch<HrCalendarAssignment>(
        `/api/v1/hr/calendar-assignments/${uuid}`,
        { calendar_uuid },
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

// --- Work summary ---
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
