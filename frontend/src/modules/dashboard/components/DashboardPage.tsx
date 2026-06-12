import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Banknote,
  PlaneTakeoff,
  Plane,
  Users,
  Sparkles,
  FileCheck2,
  ArrowRight,
} from 'lucide-react'
import { PageHeader } from '@club-erp/ui'
import { KpiCard } from '@/components/ui/kpi-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UnbilledFlight {
  id: string
  pilot: string
  aircraft: string
  duration: string
  type: string
  amount: number
}

// ── Mock data (TODO Phase 6: useTanStack Query) ───────────────────────────────

const MOCK_KPIS = {
  pendingRevenue: 12_487.50,
  unbilledFlights: 38,
  flightsToday: 24,
  availableAircraft: 7,
  totalAircraft: 9,
}

const MOCK_UNBILLED: UnbilledFlight[] = [
  { id: 'F-10821', pilot: 'Claire Dupont', aircraft: 'F-CABC', duration: '01:24', type: 'Solo', amount: 84.0 },
  { id: 'F-10822', pilot: 'Marc Lefevre', aircraft: 'F-CDEF', duration: '00:48', type: 'Instruction', amount: 96.5 },
  { id: 'F-10823', pilot: 'Sophie Martin', aircraft: 'F-CGHI', duration: '02:15', type: 'Solo', amount: 135.0 },
  { id: 'F-10824', pilot: 'Antoine Roy', aircraft: 'F-CABC', duration: '01:02', type: 'Découverte', amount: 110.0 },
  { id: 'F-10825', pilot: 'Léa Bernard', aircraft: 'F-CJKL', duration: '00:36', type: 'Treuillée', amount: 28.0 },
  { id: 'F-10826', pilot: 'Hugo Petit', aircraft: 'F-CDEF', duration: '03:11', type: 'Solo', amount: 191.0 },
  { id: 'F-10827', pilot: 'Camille Roux', aircraft: 'F-CGHI', duration: '01:45', type: 'Instruction', amount: 175.0 },
]

const PIPELINE_DATA = [
  { labelKey: 'home.pipeline.steps.planche', value: 24, color: 'bg-accent' },
  { labelKey: 'home.pipeline.steps.preview', value: 21, color: 'bg-[color:var(--color-warning)]' },
  { labelKey: 'home.pipeline.steps.billed', value: 18, color: 'bg-[color:var(--color-success)]' },
  { labelKey: 'home.pipeline.steps.posted', value: 12, color: 'bg-primary' },
] as const

const ALERT_ITEMS = [
  { labelKey: 'home.alerts.items.noPilot', severityKey: 'home.alerts.severity.blocking', variant: 'destructive' as const },
  { labelKey: 'home.alerts.items.inconsistency', severityKey: 'home.alerts.severity.alert', variant: 'warning' as const },
  { labelKey: 'home.alerts.items.packs', severityKey: 'home.alerts.severity.info', variant: 'secondary' as const },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const eur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()

  // TODO Phase 6: remplacer par useKpis() / useUnbilledFlights() TanStack Query
  // const { data: kpis } = useDashboardKpis()
  // const { data: unbilled } = useUnbilledFlights()
  const kpis = MOCK_KPIS
  const unbilled = MOCK_UNBILLED
  const selectedCount = 7 // TODO: état checkbox géré

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title={t('home.title')}
        supportingText={t('home.description')}
        actions={
          <>
            <Button variant="outline" size="sm">
              <FileCheck2 className="h-4 w-4" />
              {t('home.unbilledTable.viewAll')}
            </Button>
            <Button size="sm">
              <Sparkles className="h-4 w-4" />
              Lancer facturation
            </Button>
          </>
        }
      />

      {/* ── KPI Grid ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('home.kpi.pendingRevenue')}
          value={eur(kpis.pendingRevenue)}
          hint={`${kpis.unbilledFlights} ${t('home.kpi.pendingRevenueHint')}`}
          icon={Banknote}
          accent="warning"
        />
        <KpiCard
          label={t('home.kpi.unbilledFlights')}
          value={String(kpis.unbilledFlights)}
          hint={t('home.kpi.unbilledFlightsHint')}
          icon={PlaneTakeoff}
        />
        <KpiCard
          label={t('home.kpi.flightsToday')}
          value={String(kpis.flightsToday)}
          trend={{ value: '12%', positive: true }}
          icon={Plane}
          accent="success"
        />
        <KpiCard
          label={t('home.kpi.availableAircraft')}
          value={`${kpis.availableAircraft}/${kpis.totalAircraft}`}
          hint="1 en réservation, 1 en maintenance"
          icon={Users}
        />
      </div>

      {/* ── Bottom section: table + sidebar ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">

        {/* Unbilled flights table */}
        <div className="rounded-xl border bg-card xl:col-span-2">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {t('home.unbilledTable.title')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t('home.unbilledTable.source')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="rounded-md">
                {selectedCount} {t('home.unbilledTable.selected')}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1"
                onClick={() => navigate('/flights')}
              >
                {t('home.unbilledTable.viewAll')}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>{t('home.unbilledTable.colFlight')}</TableHead>
                <TableHead>{t('home.unbilledTable.colPilot')}</TableHead>
                <TableHead>{t('home.unbilledTable.colAircraft')}</TableHead>
                <TableHead>{t('home.unbilledTable.colType')}</TableHead>
                <TableHead className="text-right">{t('home.unbilledTable.colDuration')}</TableHead>
                <TableHead className="text-right">{t('home.unbilledTable.colAmount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unbilled.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <Checkbox defaultChecked />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{f.id}</TableCell>
                  <TableCell className="font-medium">{f.pilot}</TableCell>
                  <TableCell className="font-mono text-xs">{f.aircraft}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">{f.type}</Badge>
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {f.duration}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {eur(f.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pipeline + Alerts */}
        <div className="flex flex-col gap-4">
          {/* Pipeline */}
          <div className="rounded-xl border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">
              {t('home.pipeline.title')}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('home.pipeline.description')}
            </p>
            <div className="mt-4 space-y-3">
              {PIPELINE_DATA.map((step) => (
                <div key={step.labelKey}>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{t(step.labelKey)}</span>
                    <span className="tabular font-medium text-foreground">
                      {step.value}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${step.color}`}
                      style={{ width: `${(step.value / PIPELINE_DATA[0].value) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Alerts */}
          <div className="rounded-xl border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">
              {t('home.alerts.title')}
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              {ALERT_ITEMS.map((item) => (
                <li
                  key={item.labelKey}
                  className="flex items-center justify-between gap-2 rounded-md border border-dashed p-2"
                >
                  <span className="text-foreground">{t(item.labelKey)}</span>
                  <Badge
                    variant={item.variant === 'warning' ? 'outline' : item.variant}
                    className={
                      item.variant === 'warning'
                        ? 'shrink-0 rounded-sm bg-[color:var(--color-warning)] text-[color:var(--color-warning-foreground)]'
                        : 'shrink-0 rounded-sm'
                    }
                  >
                    {t(item.severityKey)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>

      </div>
    </div>
  )
}
