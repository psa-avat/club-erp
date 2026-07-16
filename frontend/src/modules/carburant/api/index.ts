import { useMutation, useQuery } from '@tanstack/react-query'

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

export const carburantQueryKeys = {
  pompe: (token: string) => ['carburant', 'plein', token] as const,
  avions: (token: string) => ['carburant', 'plein', token, 'avions'] as const,
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
