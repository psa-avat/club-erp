import { useTranslation } from 'react-i18next'
import { useMemberPortalAccount, useMemberPortalPacks } from '../api'

export function DashboardPage() {
  const { t } = useTranslation('common')
  const { data: account, isLoading: accountLoading } = useMemberPortalAccount()
  const { data: packs, isLoading: packsLoading } = useMemberPortalPacks()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">{t('portal.dashboard')}</h1>

      {accountLoading ? (
        <p className="text-sm text-slate-400">{t('portal.loading')}</p>
      ) : account ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">{t('portal.balanceAccount')}</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">
              {account.current_balance} €
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">{t('portal.pendingEntries')}</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {account.pending_entries_count}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">{t('portal.postedEntries')}</p>
            <p className="mt-1 text-2xl font-bold text-green-600">
              {account.posted_entries_count}
            </p>
          </div>
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-700">{t('portal.myPacks')}</h2>
        {packsLoading ? (
          <p className="text-sm text-slate-400">{t('portal.loading')}</p>
        ) : packs && packs.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {packs.map((pack) => (
              <div
                key={pack.pack_type}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <p className="text-sm font-medium text-slate-700">{pack.pack_type_label}</p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                    {Number(pack.total_purchased) > 0 && (
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{
                          width: `${Math.min(
                            100,
                            (Number(pack.total_consumed) / Number(pack.total_purchased)) * 100,
                          )}%`,
                        }}
                      />
                    )}
                  </div>
                  <span className="text-xs font-medium text-slate-500">
                    {pack.units_remaining} / {pack.total_purchased}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Aucun forfait actif</p>
        )}
      </section>
    </div>
  )
}
