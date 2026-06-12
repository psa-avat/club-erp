import { useTranslation } from 'react-i18next'
import { Banknote, PlaneTakeoff, Plane, Users, Sparkles, FileCheck2 } from 'lucide-react'
import { PageHeader } from '@club-erp/ui'
import { KpiCard } from '@/components/ui/kpi-card'
import { Button } from '@/components/ui/button'

export function DashboardPage() {
  const { t } = useTranslation('dashboard')

  // TODO Phase 6: remplacer par useKpis() TanStack Query
  const kpiPlaceholders = {
    pendingRevenue: '—',
    unbilledFlights: '—',
    flightsToday: '—',
    availableAircraft: '—',
    totalAircraft: '—',
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title={t('home.title')}
        supportingText={t('home.description')}
        actions={
          <>
            <Button variant="outline" size="sm">
              <FileCheck2 className="h-4 w-4" />
              Aperçu facturation
            </Button>
            <Button size="sm">
              <Sparkles className="h-4 w-4" />
              Lancer facturation
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('home.kpi.pendingRevenue')}
          value={kpiPlaceholders.pendingRevenue}
          hint={t('home.kpi.pendingRevenueHint')}
          icon={Banknote}
          accent="warning"
        />
        <KpiCard
          label={t('home.kpi.unbilledFlights')}
          value={kpiPlaceholders.unbilledFlights}
          hint={t('home.kpi.unbilledFlightsHint')}
          icon={PlaneTakeoff}
        />
        <KpiCard
          label={t('home.kpi.flightsToday')}
          value={kpiPlaceholders.flightsToday}
          icon={Plane}
          accent="success"
        />
        <KpiCard
          label={t('home.kpi.availableAircraft')}
          value={`${kpiPlaceholders.availableAircraft}/${kpiPlaceholders.totalAircraft}`}
          icon={Users}
        />
      </div>
    </div>
  )
}
