/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Asset pricing page: thin wrapper over AssetTypePricingPanel
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
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { useAssetQuery } from '../api'
import { AssetTypePricingPanel } from './AssetTypePricingPanel'

export function AssetPricingPage() {
  const { t } = useTranslation('pricing')
  const navigate = useNavigate()
  const { uuid } = useParams<{ uuid: string }>()

  const assetQuery = useAssetQuery(uuid ?? null)
  const asset = assetQuery.data ?? null

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button
          className="h-8 rounded-md bg-transparent px-3 text-xs text-on-surface hover:bg-surface-container"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          {t('back')}
        </Button>
        <h1 className="text-lg font-semibold text-on-surface">
          {asset ? `${asset.registration} — ${t('title')}` : t('title')}
        </h1>
      </div>

      {assetQuery.isLoading ? (
        <p className="text-sm text-on-surface-variant">{t('states.loading')}</p>
      ) : !asset?.asset_type_uuid ? (
        <p className="text-sm text-on-surface-variant">{t('noAssetType')}</p>
      ) : (
        <AssetTypePricingPanel assetTypeUuid={asset.asset_type_uuid} />
      )}
    </div>
  )
}
