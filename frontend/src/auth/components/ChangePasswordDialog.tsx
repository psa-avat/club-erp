/*   
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - frontend: change password dialog
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
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { useChangePassword } from '../api/useAuth'

interface Props {
  onClose: () => void
}

export function ChangePasswordDialog({ onClose }: Props) {
  const { t } = useTranslation('common')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [success, setSuccess] = useState(false)

  const changePasswordMutation = useChangePassword()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (newPassword !== confirmPassword) {
      return
    }

    await changePasswordMutation.mutateAsync(
      { current_password: currentPassword, new_password: newPassword },
      {
        onSuccess: () => {
          setSuccess(true)
          setTimeout(onClose, 1500)
        },
      },
    )
  }

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword

  const rawError = changePasswordMutation.error as AxiosError<{ detail?: string }> | null
  let errorMessage: string | null = null
  if (rawError?.response?.status === 401) {
    errorMessage = t('auth.changePassword.wrongCurrentPassword')
  } else if (rawError?.response?.status === 403) {
    errorMessage = t('auth.changePassword.notAllowed')
  } else if (rawError) {
    errorMessage = rawError.response?.data?.detail ?? t('auth.changePassword.failed')
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <Card className="relative w-full max-w-md border-slate-200 bg-white/95 shadow-2xl">
        <CardHeader>
          <CardTitle>{t('auth.changePassword.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {success ? (
            <p className="text-sm font-medium text-green-600">{t('auth.changePassword.success')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="current-password">{t('auth.changePassword.currentPassword')}</Label>
                <Input
                  autoComplete="current-password"
                  id="current-password"
                  required
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">{t('auth.changePassword.newPassword')}</Label>
                <Input
                  autoComplete="new-password"
                  id="new-password"
                  minLength={8}
                  required
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">{t('auth.changePassword.confirmPassword')}</Label>
                <Input
                  autoComplete="new-password"
                  id="confirm-password"
                  minLength={8}
                  required
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                {mismatch ? (
                  <p className="text-xs text-red-500">{t('auth.changePassword.passwordMismatch')}</p>
                ) : null}
              </div>

              {errorMessage ? <Alert>{errorMessage}</Alert> : null}

              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={changePasswordMutation.isPending || mismatch}
                  type="submit"
                >
                  {changePasswordMutation.isPending
                    ? t('auth.changePassword.saving')
                    : t('auth.changePassword.save')}
                </Button>
                <Button
                  className="flex-1"
                  disabled={changePasswordMutation.isPending}
                  type="button"
                  variant="secondary"
                  onClick={onClose}
                >
                  {t('auth.changePassword.cancel')}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>,
    document.body,
  )
}
