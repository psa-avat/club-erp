import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { AxiosError } from 'axios'
import { useTranslation } from 'react-i18next'

import { useAssetsPublicQuery, usePompePublicQuery, useSubmitPleinMutation } from '../api'

function extractErrorKey(e: unknown): 'rateLimited' | 'generic' {
  if (e instanceof AxiosError && e.response?.status === 429) {
    return 'rateLimited'
  }
  return 'generic'
}

export function FuelDeclarePage() {
  const { t } = useTranslation('carburant')
  const { token } = useParams<{ token: string }>()

  const [assetUuid, setAssetUuid] = useState('')
  const [quantiteL, setQuantiteL] = useState('')
  const [indexCompteur, setIndexCompteur] = useState('')
  const [declarant, setDeclarant] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const pompeQuery = usePompePublicQuery(token ?? '')
  const assetsQuery = useAssetsPublicQuery(token ?? '', pompeQuery.isSuccess)
  const submitMutation = useSubmitPleinMutation(token ?? '')

  if (!token) {
    return null
  }

  if (pompeQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <p className="text-sm text-slate-500">{t('public.loading')}</p>
      </div>
    )
  }

  if (pompeQuery.isError || !pompeQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-8 text-center shadow-lg">
          <p className="text-sm text-red-600">{t('public.pompeNotFound')}</p>
        </div>
      </div>
    )
  }

  const pompe = pompeQuery.data

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!assetUuid || !quantiteL.trim() || !declarant.trim()) {
      setFormError(t('public.errors.required'))
      return
    }

    try {
      await submitMutation.mutateAsync({
        asset_uuid: assetUuid,
        quantite_l: quantiteL.trim(),
        index_compteur: indexCompteur.trim() ? indexCompteur.trim() : undefined,
        membre_declarant: declarant.trim(),
      })
    } catch (err) {
      setFormError(t(`public.errors.${extractErrorKey(err)}`))
    }
  }

  if (submitMutation.isSuccess) {
    const anomalie = submitMutation.data?.flag_anomalie
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-8 text-center shadow-lg">
          <h1 className="text-xl font-bold text-slate-800">{t('public.success.title')}</h1>
          <p className="mt-2 text-sm text-slate-600">{t('public.success.message')}</p>
          {anomalie && (
            <p className="mt-2 text-sm text-amber-600">{t('public.success.anomalyNote')}</p>
          )}
          <button
            type="button"
            onClick={() => {
              submitMutation.reset()
              setAssetUuid('')
              setQuantiteL('')
              setIndexCompteur('')
              setDeclarant('')
            }}
            className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t('public.success.again')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-800">{t('public.form.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('public.form.pompeSubtitle', {
              nom: pompe.nom,
              typeCarburant: t(`typeCarburant.${pompe.type_carburant}`),
            })}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">{t('public.form.asset')}</label>
            <select
              value={assetUuid}
              onChange={(e) => setAssetUuid(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('public.form.assetPlaceholder')}</option>
              {assetsQuery.data?.map((asset) => (
                <option key={asset.uuid} value={asset.uuid}>
                  {asset.registration ? `${asset.registration} — ${asset.name}` : asset.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">{t('public.form.quantite')}</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={quantiteL}
              onChange={(e) => setQuantiteL(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">{t('public.form.indexCompteur')}</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={indexCompteur}
              onChange={(e) => setIndexCompteur(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">{t('public.form.declarant')}</label>
            <input
              type="text"
              value={declarant}
              onChange={(e) => setDeclarant(e.target.value)}
              placeholder={t('public.form.declarantPlaceholder')}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <button
            type="submit"
            disabled={submitMutation.isPending}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {submitMutation.isPending ? t('public.form.submitting') : t('public.form.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
