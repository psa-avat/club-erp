export interface AuthUser {
  id: number
  email: string
  prenom: string
  nom: string
  role: number
}

export interface LoginRequest {
  email: string
  password: string
  prenom?: string
  nom?: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  expires_at: string
  user: AuthUser
}

export interface MeResponse extends AuthUser {
  is_active: boolean
  auth_expiration_date: string | null
}
