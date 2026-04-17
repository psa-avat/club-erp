import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '../../../api/client'
import type {
  AdminCapability,
  AdminRole,
  AdminUser,
  CreateAdminCapabilityPayload,
  CreateAdminRolePayload,
  CreateAdminUserPayload,
  UpdateAdminCapabilityPayload,
  UpdateAdminRolePayload,
  UpdateAdminUserPayload,
} from '../types'

export const adminQueryKeys = {
  root: ['admin'] as const,
  users: ['admin', 'users'] as const,
  roles: ['admin', 'roles'] as const,
  capabilities: ['admin', 'capabilities'] as const,
}

export function useAdminUsersQuery() {
  return useQuery({
    queryKey: adminQueryKeys.users,
    queryFn: async () => {
      const { data } = await apiClient.get<AdminUser[]>('/api/v1/admin/users')
      return data
    },
  })
}

export function useCreateAdminUserMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateAdminUserPayload) => {
      const { data } = await apiClient.post<AdminUser>('/api/v1/admin/users', payload)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })
}

export function useUpdateAdminUserMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, payload }: { userId: number; payload: UpdateAdminUserPayload }) => {
      const { data } = await apiClient.put<AdminUser>(`/api/v1/admin/users/${userId}`, payload)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })
}

export function useDeleteAdminUserMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: number) => {
      await apiClient.delete(`/api/v1/admin/users/${userId}`)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })
}

export function useAdminRolesQuery() {
  return useQuery({
    queryKey: adminQueryKeys.roles,
    queryFn: async () => {
      const { data } = await apiClient.get<AdminRole[]>('/api/v1/admin/roles')
      return data
    },
  })
}

export function useCreateAdminRoleMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateAdminRolePayload) => {
      const { data } = await apiClient.post<AdminRole>('/api/v1/admin/roles', payload)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles })
    },
  })
}

export function useUpdateAdminRoleMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ roleId, payload }: { roleId: number; payload: UpdateAdminRolePayload }) => {
      const { data } = await apiClient.put<AdminRole>(`/api/v1/admin/roles/${roleId}`, payload)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles })
    },
  })
}

export function useDeleteAdminRoleMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (roleId: number) => {
      await apiClient.delete(`/api/v1/admin/roles/${roleId}`)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles })
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })
}

export function useAdminCapabilitiesQuery() {
  return useQuery({
    queryKey: adminQueryKeys.capabilities,
    queryFn: async () => {
      const { data } = await apiClient.get<AdminCapability[]>('/api/v1/admin/capabilities')
      return data
    },
  })
}

export function useCreateAdminCapabilityMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateAdminCapabilityPayload) => {
      const { data } = await apiClient.post<AdminCapability>('/api/v1/admin/capabilities', payload)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.capabilities })
    },
  })
}

export function useUpdateAdminCapabilityMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      capabilityId,
      payload,
    }: {
      capabilityId: number
      payload: UpdateAdminCapabilityPayload
    }) => {
      const { data } = await apiClient.put<AdminCapability>(
        `/api/v1/admin/capabilities/${capabilityId}`,
        payload,
      )
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.capabilities })
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles })
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })
}

export function useDeleteAdminCapabilityMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (capabilityId: number) => {
      await apiClient.delete(`/api/v1/admin/capabilities/${capabilityId}`)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.capabilities })
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles })
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })
}
