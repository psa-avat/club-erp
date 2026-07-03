/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Bank reconciliation: matching thresholds/weights editor (system_settings.bank_reconciliation)
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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useBanqueModuleSettingsQuery, useUpsertBanqueModuleSettingsMutation } from '../api'

const MODULE_NAME = 'bank_reconciliation'

const DEFAULTS = {
  amount_tolerance: '0.05',
  date_tolerance_days: '7',
  weight_amount: '0.5',
  weight_date: '0.3',
  weight_description: '0.2',
  auto_accept_threshold: '0.90',
  review_threshold: '0.40',
  internal_transfer_cap: '0.60',
}

type MatchingSettingsForm = typeof DEFAULTS

interface Props {
  open: boolean
  onClose: () => void
}

export function ReconciliationMatchingSettingsDialog({ open, onClose }: Props) {
  const { t } = useTranslation('banque')
  const { data, isLoading } = useBanqueModuleSettingsQuery(MODULE_NAME, open)
  const upsertMutation = useUpsertBanqueModuleSettingsMutation(MODULE_NAME)
  const [form, setForm] = useState<MatchingSettingsForm>(DEFAULTS)

  useEffect(() => {
    if (!data) return
    const matching = (data.settings?.matching ?? {}) as Partial<Record<keyof MatchingSettingsForm, unknown>>
    setForm({
      ...DEFAULTS,
      ...Object.fromEntries(
        Object.entries(matching).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
      ),
    })
  }, [data])

  function setField(key: keyof MatchingSettingsForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    try {
      await upsertMutation.mutateAsync({
        settings: {
          matching: {
            amount_tolerance: form.amount_tolerance,
            date_tolerance_days: Number(form.date_tolerance_days) || 0,
            weight_amount: Number(form.weight_amount) || 0,
            weight_date: Number(form.weight_date) || 0,
            weight_description: Number(form.weight_description) || 0,
            auto_accept_threshold: Number(form.auto_accept_threshold) || 0,
            review_threshold: Number(form.review_threshold) || 0,
            internal_transfer_cap: Number(form.internal_transfer_cap) || 0,
          },
        },
      })
      toast.success(t('reconciliation.settings.saved', 'Paramètres de matching enregistrés'))
      onClose()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err instanceof Error ? err.message : t('reconciliation.settings.error', "Échec de l'enregistrement"))
      toast.error(detail)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="sm:max-w-lg" aria-labelledby="matching-settings-title">
        <div className="space-y-4">
          <div>
            <h2 id="matching-settings-title" className="text-lg font-semibold text-foreground">
              {t('reconciliation.settings.title', 'Paramètres de matching')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                'reconciliation.settings.description',
                "Le score global combine montant, date et libellé, chacun pondéré. Les seuils déterminent l'auto-validation et la revue manuelle.",
              )}
            </p>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading', 'Chargement…')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('reconciliation.settings.amountTolerance', 'Tolérance montant (€)')}</Label>
                <Input type="number" step="0.01" min="0" value={form.amount_tolerance} onChange={(e) => setField('amount_tolerance', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t('reconciliation.settings.dateTolerance', 'Tolérance date (jours)')}</Label>
                <Input type="number" step="1" min="0" value={form.date_tolerance_days} onChange={(e) => setField('date_tolerance_days', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t('reconciliation.settings.weightAmount', 'Poids montant')}</Label>
                <Input type="number" step="0.05" min="0" max="1" value={form.weight_amount} onChange={(e) => setField('weight_amount', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t('reconciliation.settings.weightDate', 'Poids date')}</Label>
                <Input type="number" step="0.05" min="0" max="1" value={form.weight_date} onChange={(e) => setField('weight_date', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t('reconciliation.settings.weightDescription', 'Poids libellé')}</Label>
                <Input type="number" step="0.05" min="0" max="1" value={form.weight_description} onChange={(e) => setField('weight_description', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t('reconciliation.settings.internalTransferCap', 'Plafond virement interne')}</Label>
                <Input type="number" step="0.05" min="0" max="1" value={form.internal_transfer_cap} onChange={(e) => setField('internal_transfer_cap', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t('reconciliation.settings.autoAcceptThreshold', 'Seuil auto-validation')}</Label>
                <Input type="number" step="0.05" min="0" max="1" value={form.auto_accept_threshold} onChange={(e) => setField('auto_accept_threshold', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t('reconciliation.settings.reviewThreshold', 'Seuil de revue')}</Label>
                <Input type="number" step="0.05" min="0" max="1" value={form.review_threshold} onChange={(e) => setField('review_threshold', e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('reconciliation.settings.cancel', 'Annuler')}
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={upsertMutation.isPending || isLoading}>
              {upsertMutation.isPending ? t('reconciliation.settings.saving', 'Enregistrement…') : t('reconciliation.settings.save', 'Enregistrer')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
