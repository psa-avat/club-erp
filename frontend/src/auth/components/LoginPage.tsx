import { AxiosError } from 'axios'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'

import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { useLogin } from '../api/useAuth'

interface LoginErrorResponse {
  detail?: string
}

export function LoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const loginMutation = useLogin()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    await loginMutation.mutateAsync({ email, password })

    const targetPath =
      typeof location.state === 'object' && location.state !== null && 'from' in location.state
        ? String(location.state.from)
        : '/'

    navigate(targetPath, { replace: true })
  }

  const rawError = loginMutation.error as AxiosError<LoginErrorResponse> | null
  const statusCode = rawError?.response?.status

  const targetPath =
    typeof location.state === 'object' && location.state !== null && 'from' in location.state
      ? String(location.state.from)
      : '/'

  let errorMessage: string | null = null
  if (statusCode === 401) {
    errorMessage = 'Identifiants invalides. Verifiez votre email et votre mot de passe.'
  } else if (statusCode === 403) {
    errorMessage = 'Ce compte est inactif. Contactez un administrateur.'
  } else if (statusCode === 422) {
    errorMessage = 'Le format de l\'email est invalide.'
  } else if (rawError) {
    errorMessage = rawError.response?.data?.detail ?? 'Connexion impossible. Reessayez dans un instant.'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-10 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={() => navigate(targetPath, { replace: true })} />
      <Card className="relative w-full max-w-md border-slate-200 bg-white/95 shadow-2xl">
        <button
          aria-label="Fermer la fenetre de connexion"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          type="button"
          onClick={() => navigate(targetPath, { replace: true })}
        >
          <X className="h-4 w-4" />
        </button>
        <CardHeader>
          <CardTitle>Club ERP</CardTitle>
          <CardDescription>Connexion securisee a votre espace club.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
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
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                autoComplete="current-password"
                id="password"
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {errorMessage ? <Alert>{errorMessage}</Alert> : null}

            <Button className="w-full" disabled={loginMutation.isPending} type="submit">
              {loginMutation.isPending ? 'Connexion en cours...' : 'Se connecter'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
