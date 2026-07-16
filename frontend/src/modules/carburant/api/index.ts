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

export type MouvementCarburant = {
  uuid: string
  pompe_uuid: string
  pompe_nom: string
  asset_uuid: string
  asset_registration: string | null
  asset_name: string
  quantite_l: string
  index_compteur: string | null
  membre_declarant: string
  date_saisie: string
  statut: number
  ip_source: string | null
  flag_anomalie: boolean
  commentaire_validation: string | null
  validated_at: string | null
}

export type Ravitaillement = {
  uuid: string
  pompe_uuid: string
  pompe_nom: string
  quantite_l: string
  date_ravitaillement: string
  note: string | null
  created_at: string
}

export type RavitaillementCreateRequest = {
  pompe_uuid: string
  quantite_l: string
  date_ravitaillement: string
  note?: string | null
}

export type StockCarburantEntry = {
  pompe_uuid: string
  pompe_nom: string
  type_carburant: number
  actif: boolean
  total_ravitaillements_l: string
  total_consommation_l: string
  stock_l: string
  derniere_activite: string | null
}

export const carburantQueryKeys = {
  pompe: (token: string) => ['carburant', 'plein', token] as const,
  avions: (token: string) => ['carburant', 'plein', token, 'avions'] as const,
  pompes: ['carburant', 'admin', 'pompes'] as const,
  mouvements: (statut?: number) => ['carburant', 'admin', 'mouvements', statut] as const,
  ravitaillements: ['carburant', 'admin', 'ravitaillements'] as const,
  stock: ['carburant', 'admin', 'stock'] as const,
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

// ── Admin: validation queue ─────────────────────────────────────────────────

export function useMouvementsQuery(statut?: number) {
  return useQuery({
    queryKey: carburantQueryKeys.mouvements(statut),
    queryFn: async () => {
      const { data } = await apiClient.get<{ items: MouvementCarburant[] }>(
        '/api/v1/admin/carburant/mouvements',
        { params: statut !== undefined ? { statut } : undefined },
      )
      return data.items
    },
  })
}

function useInvalidateMouvementsAndStock() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['carburant', 'admin', 'mouvements'] })
    qc.invalidateQueries({ queryKey: carburantQueryKeys.stock })
  }
}

export function useValiderMouvementMutation() {
  const invalidate = useInvalidateMouvementsAndStock()
  return useMutation({
    mutationFn: async ({ uuid, commentaire_validation }: { uuid: string; commentaire_validation?: string }) => {
      const { data } = await apiClient.post<MouvementCarburant>(
        `/api/v1/admin/carburant/mouvements/${uuid}/valider`,
        { commentaire_validation },
      )
      return data
    },
    onSuccess: invalidate,
  })
}

export function useRejeterMouvementMutation() {
  const invalidate = useInvalidateMouvementsAndStock()
  return useMutation({
    mutationFn: async ({ uuid, commentaire_validation }: { uuid: string; commentaire_validation: string }) => {
      const { data } = await apiClient.post<MouvementCarburant>(
        `/api/v1/admin/carburant/mouvements/${uuid}/rejeter`,
        { commentaire_validation },
      )
      return data
    },
    onSuccess: invalidate,
  })
}

// ── Admin: ravitaillements ───────────────────────────────────────────────────

export function useRavitaillementsQuery() {
  return useQuery({
    queryKey: carburantQueryKeys.ravitaillements,
    queryFn: async () => {
      const { data } = await apiClient.get<{ items: Ravitaillement[] }>(
        '/api/v1/admin/carburant/ravitaillements',
      )
      return data.items
    },
  })
}

export function useCreateRavitaillementMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: RavitaillementCreateRequest) => {
      const { data } = await apiClient.post<Ravitaillement>('/api/v1/admin/carburant/ravitaillements', body)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: carburantQueryKeys.ravitaillements })
      qc.invalidateQueries({ queryKey: carburantQueryKeys.stock })
    },
  })
}

// ── Admin: stock ──────────────────────────────────────────────────────────────

export function useStockQuery() {
  return useQuery({
    queryKey: carburantQueryKeys.stock,
    queryFn: async () => {
      const { data } = await apiClient.get<{ items: StockCarburantEntry[] }>('/api/v1/admin/carburant/stock')
      return data.items
    },
  })
}
