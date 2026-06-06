import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useMemberPortalLogin, isPortalAuthenticated } from '../api'

export function LoginPage() {
  const navigate = useNavigate()
  const [memberId, setMemberId] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loginMutation = useMemberPortalLogin()

  // Already logged in → redirect
  if (isPortalAuthenticated()) {
    return <Navigate to="/member-portal/dashboard" replace />
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!memberId.trim() || !token.trim()) {
      setError('Veuillez remplir tous les champs')
      return
    }
    try {
      await loginMutation.mutateAsync({
        memberIdentifier: memberId.trim(),
        expenseToken: token.trim(),
      })
      navigate('/member-portal/dashboard', { replace: true })
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } }
        setError(axiosErr.response?.data?.detail ?? 'Échec de la connexion')
      } else {
        setError('Échec de la connexion')
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-800">Club ERP</h1>
          <p className="mt-1 text-sm text-slate-500">Portail membre</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Identifiant membre
            </label>
            <input
              type="text"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              placeholder="Votre n° d'adhérent ou email"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Code d'accès
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Votre code d'accès"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loginMutation.isPending ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Ce portail est réservé aux membres du club.<br />
          Si vous n'avez pas de code d'accès, contactez le bureau.
        </p>
      </div>
    </div>
  )
}
