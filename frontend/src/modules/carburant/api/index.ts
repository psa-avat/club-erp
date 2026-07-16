import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'

export type PompePublic = {
  uuid: string
  nom: string
  type_carburant: number
}

export type AssetPublicOption = {
  uuid: string
  registration: string | null
  name: string
}

export type MouvementCarburantCreateRequest = {
  asset_uuid: string
  quantite_l: string
  index_compteur?: string
  membre_declarant: string
}

export type MouvementCarburantCreateResponse = {
  uuid: string
  statut: number
  flag_anomalie: boolean
}

export type Pompe = {
  uuid: string
  nom: string
  type_carburant: number
  token: string
  actif: boolean
  capacite_cuve_l: string | null
  index_initial: string | null
  index_initial_date: string | null
  created_at: string
  updated_at: string
}

export type PompeCreateRequest = {
  nom: string
  type_carburant: number
  actif: boolean
  capacite_cuve_l?: string | null
  index_initial?: string | null
  index_initial_date?: string | null
}

export type PompeUpdateRequest = Partial<PompeCreateRequest>

export const carburantQueryKeys = {
  pompe: (token: string) => ['carburant', 'plein', token] as const,
  avions: (token: string) => ['carburant', 'plein', token, 'avions'] as const,
  pompes: ['carburant', 'admin', 'pompes'] as const,
}

export function usePompePublicQuery(token: string) {
  return useQuery({
    queryKey: carburantQueryKeys.pompe(token),
    queryFn: async () => {
      const { data } = await apiClient.get<PompePublic>(`/api/v1/carburant/plein/${token}`)
      return data
    },
    retry: false,
  })
}

export function useAssetsPublicQuery(token: string, enabled: boolean) {
  return useQuery({
    queryKey: carburantQueryKeys.avions(token),
    queryFn: async () => {
      const { data } = await apiClient.get<{ items: AssetPublicOption[] }>(
        `/api/v1/carburant/plein/${token}/avions`,
      )
      return data.items
    },
    enabled,
  })
}

export function useSubmitPleinMutation(token: string) {
  return useMutation({
    mutationFn: async (body: MouvementCarburantCreateRequest) => {
      const { data } = await apiClient.post<MouvementCarburantCreateResponse>(
        `/api/v1/carburant/plein/${token}`,
        body,
      )
      return data
    },
  })
}

// ── Admin: pompes ────────────────────────────────────────────────────────────

export function usePompesQuery() {
  return useQuery({
    queryKey: carburantQueryKeys.pompes,
    queryFn: async () => {
      const { data } = await apiClient.get<{ items: Pompe[] }>('/api/v1/admin/carburant/pompes')
      return data.items
    },
  })
}

export function useCreatePompeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: PompeCreateRequest) => {
      const { data } = await apiClient.post<Pompe>('/api/v1/admin/carburant/pompes', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: carburantQueryKeys.pompes }),
  })
}

export function useUpdatePompeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ uuid, body }: { uuid: string; body: PompeUpdateRequest }) => {
      const { data } = await apiClient.patch<Pompe>(`/api/v1/admin/carburant/pompes/${uuid}`, body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: carburantQueryKeys.pompes }),
  })
}

export function useRotatePompeTokenMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (uuid: string) => {
      const { data } = await apiClient.post<Pompe>(`/api/v1/admin/carburant/pompes/${uuid}/rotate-token`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: carburantQueryKeys.pompes }),
  })
}

// The QR endpoint requires the staff Authorization header, which a plain <img src=...>
// request cannot carry — fetch the SVG markup via apiClient instead and render it inline.
export function usePompeQrCodeQuery(uuid: string, enabled: boolean) {
  return useQuery({
    queryKey: ['carburant', 'admin', 'pompes', uuid, 'qrcode'] as const,
    queryFn: async () => {
      const { data } = await apiClient.get<string>(`/api/v1/admin/carburant/pompes/${uuid}/qrcode`, {
        params: { base_url: window.location.origin },
        responseType: 'text',
      })
      return data
    },
    enabled,
  })
}

export function pleinUrl(token: string): string {
  return `${window.location.origin}/plein/${token}`
}
