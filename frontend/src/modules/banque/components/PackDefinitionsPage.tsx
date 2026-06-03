/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - banque/packs: Pack definition list + create/edit page
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
import React, { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { AxiosError } from 'axios'

import { Button } from '../../../components/ui/button'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  usePackDefinitionsQuery,
  usePackDefinitionQuery,
  useCreatePackDefinitionMutation,
  useUpdatePackDefinitionMutation,
  useDeletePackDefinitionMutation,
  useFiscalYearsQuery,
  useAccountsQuery,
  useAllActivePricingItemsQuery,
} from '../api'
import {
  PackDefinitionForm,
  type PackFormState,
  type ApplicableItemFormEntry,
} from './PackDefinitionForm'

// ---------------------------------------------------------------------------
// List Page
// ---------------------------------------------------------------------------

export function PackDefinitionsPage() {
  const { t } = useTranslation(['banque', 'common'])
  const canView = useCapability('VIEW_FINANCIALS')
  const canManage = useCapability('MANAGE_PRICES')
  const navigate = useNavigate()

  const fiscalYearsQuery = useFiscalYearsQuery(canView)
  const fiscalYears = fiscalYearsQuery.data ?? []

  const [selectedFyUuid, setSelectedFyUuid] = useState<string>('')

  const packsQuery = usePackDefinitionsQuery(selectedFyUuid || undefined, undefined, canView)
  const packs = packsQuery.data ?? []
  const deleteMutation = useDeletePackDefinitionMutation()
  const [deleteUuid, setDeleteUuid] = useState<string | null>(null)
  const [expandedPackUuid, setExpandedPackUuid] = useState<string | null>(null)

  const allItemsQuery = useAllActivePricingItemsQuery(true)
  const allItems = allItemsQuery.data ?? []
  const itemNameLookup = new Map(allItems.map((i) => [i.uuid, `${i.version_name} — ${i.name}`]))

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('common.noPermission')}</p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('packs.definitions.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('packs.definitions.description')}</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={selectedFyUuid}
            onChange={(e) => setSelectedFyUuid(e.target.value)}
          >
            <option value="">{t('common.allFiscalYears')}</option>
            {fiscalYears.map((fy) => (
              <option key={fy.uuid} value={fy.uuid}>{fy.code}</option>
            ))}
          </select>
          {canManage && (
            <Button onClick={() => navigate('/banque/packs/new')}>
              <Plus className="mr-1 h-4 w-4" /> {t('packs.definitions.create')}
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="w-8 px-2 py-3"></th>
              <th className="px-4 py-3 font-medium text-slate-600">{t('packs.definitions.code')}</th>
              <th className="px-4 py-3 font-medium text-slate-600">{t('packs.definitions.name')}</th>
              <th className="px-4 py-3 font-medium text-slate-600">{t('packs.definitions.type')}</th>
              <th className="px-4 py-3 font-medium text-slate-600">{t('packs.definitions.allowance')}</th>
              <th className="px-4 py-3 font-medium text-slate-600">{t('packs.definitions.applicableItems')}</th>
              <th className="px-4 py-3 font-medium text-slate-600">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {packs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                  {t('packs.definitions.empty')}
                </td>
              </tr>
            )}
            {packs.map((pack) => (
              <React.Fragment key={pack.uuid}>
                <tr
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                  onClick={() => setExpandedPackUuid(expandedPackUuid === pack.uuid ? null : pack.uuid)}
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                      onClick={(e) => { e.stopPropagation(); setExpandedPackUuid(expandedPackUuid === pack.uuid ? null : pack.uuid); }}
                    >
                      {expandedPackUuid === pack.uuid ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{pack.code}</td>
                  <td className="px-4 py-3 text-slate-700">{pack.name}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {pack.pack_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{pack.quantity_allowance} {pack.quantity_unit}</td>
                  <td className="px-4 py-3 text-slate-700">{pack.applicability?.length ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/banque/packs/${pack.uuid}`); }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title={t('common.edit')}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {canManage && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteUuid(pack.uuid); }}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedPackUuid === pack.uuid && (
                  <tr key={`${pack.uuid}-items`}>
                    <td colSpan={7} className="border-b border-slate-100 bg-slate-50 px-6 py-4">
                      {pack.applicability && pack.applicability.length > 0 ? (
                        <div className="space-y-1.5">
                          {pack.applicability.map((app) => (
                            <div
                              key={app.uuid}
                              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                            >
                              <span className="font-medium text-slate-900">
                                {itemNameLookup.get(app.pricing_item_uuid) ?? app.pricing_item_uuid.slice(0, 8)}
                              </span>
                              <span className="ml-auto text-slate-600">
                                {t('packs.definitions.discountedPrice')}: {app.discounted_unit_price} €
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-sm text-slate-400">
                          {t('packs.definitions.noRatesLinked')}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteUuid !== null}
        title={t('packs.definitions.confirmDelete')}
        onConfirm={async () => {
          if (deleteUuid) {
            await deleteMutation.mutateAsync(deleteUuid)
            setDeleteUuid(null)
          }
        }}
        onCancel={() => setDeleteUuid(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit / Create Page
// ---------------------------------------------------------------------------

export function PackDefinitionEditPage() {
  const { t } = useTranslation(['banque', 'common'])
  const { packUuid } = useParams<{ packUuid: string }>()
  const navigate = useNavigate()
  const isNew = packUuid === 'new'
  const canManage = useCapability('MANAGE_PRICES')

  const fiscalYearsQuery = useFiscalYearsQuery(true)
  const accountsQuery = useAccountsQuery(true)
  const allItemsQuery = useAllActivePricingItemsQuery(true)
  const pricingItems = allItemsQuery.data ?? []

  // Pack data if editing
  const packQuery = usePackDefinitionQuery(isNew ? null : packUuid ?? null, !isNew)
  const pack = packQuery.data

  const createMutation = useCreatePackDefinitionMutation()
  const updateMutation = useUpdatePackDefinitionMutation()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canManage) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t('common.noPermission')}</p>
      </section>
    )
  }

  const initialForm: PackFormState = pack
    ? {
        code: pack.code,
        name: pack.name,
        fiscal_year_uuid: pack.fiscal_year_uuid,
        pack_type: pack.pack_type,
        quantity_allowance: pack.quantity_allowance,
        quantity_unit: pack.quantity_unit,
        pack_sales_account_uuid: pack.pack_sales_account_uuid,
        pack_discount_expense_account_uuid: pack.pack_discount_expense_account_uuid,
        priority: pack.priority,
      }
    : {
        code: '',
        name: '',
        fiscal_year_uuid: '',
        pack_type: 'flight_hours',
        quantity_allowance: '25.00',
        quantity_unit: 'hours',
        pack_sales_account_uuid: null,
        pack_discount_expense_account_uuid: null,
        priority: 0,
      }

  const initialItems: ApplicableItemFormEntry[] = (pack?.applicability ?? []).map((a) => ({
    pricing_item_uuid: a.pricing_item_uuid,
    discounted_unit_price: a.discounted_unit_price,
    _key: `init_${a.uuid}`,
  }))

  async function handleSave(form: PackFormState, items: ApplicableItemFormEntry[]) {
    setSaving(true)
    setError(null)
    try {
      const applicable_items = items
        .filter((i) => i.pricing_item_uuid)
        .map((i) => ({
          pricing_item_uuid: i.pricing_item_uuid,
          discounted_unit_price: i.discounted_unit_price,
        }))

      if (isNew) {
        await createMutation.mutateAsync({
          ...form,
          applicable_items,
        })
      } else if (packUuid) {
        await updateMutation.mutateAsync({
          packUuid,
          payload: {
            ...form,
            applicable_items: applicable_items.length > 0 ? applicable_items : undefined,
          },
        })
      }
      navigate('/banque/packs')
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.detail) {
        setError(String(err.response.data.detail))
      } else {
        setError(t('common.error.generic'))
      }
    } finally {
      setSaving(false)
    }
  }

  const fiscalYears = fiscalYearsQuery.data ?? []
  const accounts = accountsQuery.data ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link to="/banque/packs" className="hover:text-slate-700">{t('packs.definitions.title')}</Link>
          <span>/</span>
          <span className="text-slate-900">{isNew ? t('common.create') : pack?.code ?? t('common.loading')}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {(isNew || pack) && (
        <PackDefinitionForm
          initial={initialForm}
          applicability={initialItems}
          fiscalYears={fiscalYears}
          pricingItems={pricingItems}
          accounts={accounts}
          saving={saving}
          onSave={handleSave}
          onCancel={() => navigate('/banque/packs')}
        />
      )}
    </div>
  )
}
