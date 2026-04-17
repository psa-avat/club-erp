import { useTranslation } from 'react-i18next'

export function DashboardPage() {
  const { t } = useTranslation('dashboard')

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">{t('home.title')}</h1>
      <p className="text-sm text-slate-600">{t('home.description')}</p>
    </section>
  )
}
