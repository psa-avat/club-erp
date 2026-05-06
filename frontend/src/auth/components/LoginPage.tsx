/*   
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - frontend API pour l'authentification
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

import { AxiosError } from 'axios'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { useLogin, useVerifyPin } from '../api/useAuth'
import { useAuthStore } from '../store/authStore'

interface LoginErrorResponse {
  detail?: string
}

function getPostLoginTarget(locationState: unknown): string {
  if (
    typeof locationState === 'object' &&
    locationState !== null &&
    'from' in locationState
  ) {
    const from = String(locationState.from)
    return from === '/login' ? '/dashboard' : from
  }

  return '/dashboard'
}

export function LoginPage() {
  const { t } = useTranslation('common')
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')

  const loginMutation = useLogin()
  const verifyPinMutation = useVerifyPin()
  const authState = useAuthStore((state) => state.authState)
  const preAuthToken = useAuthStore((state) => state.preAuthToken)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (authState === 'pre_auth') {
      if (!preAuthToken) {
        return
      }

      const verifyResult = await verifyPinMutation.mutateAsync({
        pre_auth_token: preAuthToken,
        pin,
      })

      if (verifyResult.auth_state !== 'full_auth') {
        return
      }
    } else {
      const loginResult = await loginMutation.mutateAsync({ email, password })
      if (loginResult.auth_state !== 'full_auth') {
        return
      }
    }

    const targetPath = getPostLoginTarget(location.state)

    navigate(targetPath, { replace: true })
  }

  const rawError = (authState === 'pre_auth'
    ? (verifyPinMutation.error as AxiosError<LoginErrorResponse> | null)
    : (loginMutation.error as AxiosError<LoginErrorResponse> | null))
  const statusCode = rawError?.response?.status

  const targetPath = getPostLoginTarget(location.state)

  let errorMessage: string | null = null
  if (statusCode === 401) {
    errorMessage = t('auth.invalidCredentials')
  } else if (statusCode === 403) {
    errorMessage = t('auth.inactiveAccount')
  } else if (statusCode === 422) {
    errorMessage = t('auth.invalidEmail')
  } else if (rawError) {
    errorMessage = rawError.response?.data?.detail ?? t('auth.loginFailed')
  }

  const isSubmitting = loginMutation.isPending || verifyPinMutation.isPending
  const pinDeliveryWarning = loginMutation.data?.pin_delivery_warning === true

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-10 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={() => navigate(targetPath, { replace: true })} />
      <Card className="relative w-full max-w-md border-slate-200 bg-white/95 shadow-2xl">
        <button
          aria-label={t('auth.closeLoginModal')}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          type="button"
          onClick={() => navigate(targetPath, { replace: true })}
        >
          <X className="h-4 w-4" />
        </button>
        <CardHeader>
          <CardTitle>{t('app.name')}</CardTitle>
          <CardDescription>
            {authState === 'pre_auth' ? t('auth.enterPin') : t('auth.secureLogin')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {authState === 'pre_auth' ? (
              <div className="space-y-2">
                <Label htmlFor="pin">{t('auth.pinLabel')}</Label>
                <Input
                  id="pin"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  required
                  type="text"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">{t('auth.email')}</Label>
                  <Input
                    autoComplete="username"
                    id="email"
                    placeholder="nom@club.fr"
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t('auth.password')}</Label>
                  <Input
                    autoComplete="current-password"
                    id="password"
                    required
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              </>
            )}

            {errorMessage ? <Alert>{errorMessage}</Alert> : null}
            {authState === 'pre_auth' && pinDeliveryWarning ? (
              <Alert className="border-amber-300 bg-amber-50 text-amber-800">
                {t('auth.pinDeliveryWarning')}
              </Alert>
            ) : null}

            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting
                ? t('auth.loginInProgress')
                : authState === 'pre_auth'
                  ? t('auth.verifyPin')
                  : t('auth.login')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
