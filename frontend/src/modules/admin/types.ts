export type AdminUser = {
  id: number
  email: string
  prenom: string | null
  nom: string | null
  is_active: boolean
  roles: string[]
  capabilities: string[]
  can_change_password: boolean
}

export type AdminRole = {
  id: number
  code: number
  slug: string
  name: string
  is_active: boolean
  capabilities: string[]
}

export type AdminCapability = {
  id: number
  code: string
  name: string
  description: string | null
}

export type CreateAdminUserPayload = {
  email: string
  password: string
  prenom?: string
  nom?: string
  is_active: boolean
  role_slugs: string[]
}

export type UpdateAdminUserPayload = Partial<CreateAdminUserPayload> & {
  can_change_password?: boolean
}

export type CreateAdminRolePayload = {
  code: number
  slug: string
  name: string
  is_active: boolean
  capability_codes: string[]
}

export type UpdateAdminRolePayload = Partial<CreateAdminRolePayload>

export type CreateAdminCapabilityPayload = {
  code: string
  name: string
  description?: string
}

export type UpdateAdminCapabilityPayload = Partial<CreateAdminCapabilityPayload>
