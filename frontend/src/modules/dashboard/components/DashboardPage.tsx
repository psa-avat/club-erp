import { useTranslation } from 'react-i18next'
import { PageHeader } from '@club-erp/ui'

export function DashboardPage() {
  const { t } = useTranslation('dashboard')

  return (
    <section className="space-y-4">
      <PageHeader
        title={t('home.title')}
        supportingText={t('home.description')}
      />
    </section>
  )
}
