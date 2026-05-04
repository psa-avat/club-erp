import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const SETTINGS_SECTIONS = ['accounting', 'pricing', 'budget', 'integrations'] as const

export function BanquePage() {
  const { t } = useTranslation('banque')

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{t('home.title')}</h1>
        <p className="text-sm text-slate-600">{t('home.description')}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">{t('dashboard.title')}</h2>
          <p className="text-sm text-slate-600">{t('dashboard.description')}</p>
        </header>
        <div className="mt-4">
          <Link
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 transition-colors hover:bg-slate-100"
            to="/banque/dashboard"
          >
            <span className="font-semibold">{t('dashboard.title')}</span>
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">{t('journal.title')}</h2>
          <p className="text-sm text-slate-600">{t('journal.description')}</p>
        </header>
        <div className="mt-4">
          <Link
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 transition-colors hover:bg-slate-100"
            to="/banque/journal/entries"
          >
            <span className="font-semibold">{t('journal.title')}</span>
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">{t('pcg.title')}</h2>
          <p className="text-sm text-slate-600">{t('pcg.description')}</p>
        </header>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 transition-colors hover:bg-slate-100"
            to="/banque/accounts"
          >
            <span className="font-semibold">{t('coa.title')}</span>
          </Link>
          <Link
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 transition-colors hover:bg-slate-100"
            to="/banque/pcg"
          >
            <span className="font-semibold">{t('pcg.title')}</span>
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">{t('settings.title')}</h2>
          <p className="text-sm text-slate-600">{t('settings.description')}</p>
        </header>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {SETTINGS_SECTIONS.map((moduleName) => (
            <Link
              key={moduleName}
              className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 transition-colors hover:bg-slate-100"
              to={`/banque/settings/${moduleName}`}
            >
              <p className="font-semibold text-slate-900">{t(`settings.sections.${moduleName}.title`)}</p>
              <p className="mt-1 text-slate-600">{t(`settings.sections.${moduleName}.description`)}</p>
            </Link>
          ))}
        </div>

        <div className="mt-4 text-sm">
          <Link className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4" to="/banque/settings/accounting">
            {t('settings.openDefaultSection')}
          </Link>
        </div>
      </div>
    </section>
  )
}
