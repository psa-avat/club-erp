/*   
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Backend API principale
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
export interface AuthUser {
  id: number
  email: string
  prenom: string
  nom: string
  roles: string[]
  capabilities: string[]
}

export interface LoginRequest {
  email: string
  password: string
  prenom?: string
  nom?: string
}

export interface LoginResponse {
  auth_state: 'pre_auth' | 'full_auth'
  access_token?: string
  pre_auth_token?: string
  requires_pin: boolean
  token_type: 'bearer'
  expires_at: string
  user?: AuthUser
  pin_delivery_warning?: boolean
}

export interface VerifyPinRequest {
  pre_auth_token: string
  pin: string
  device_name?: string
}

export interface MeResponse extends AuthUser {
  is_active: boolean
  auth_expiration_date: string | null
  can_change_password: boolean
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}
