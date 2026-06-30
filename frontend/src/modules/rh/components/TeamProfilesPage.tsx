/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - rh: TeamProfilesPage — employee profiles list and management
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

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Pencil } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Switch,
} from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import {
  useHrProfiles,
  useCreateHrProfile,
  useUpdateHrProfile,
} from '../api'
import type { ContractType, HrEmployeeProfile } from '../types'

const CONTRACT_TYPES: ContractType[] = ['CDI', 'CDD', 'SAISONNIER', 'VACATAIRE', 'BENEVOLE']

interface ProfileFormState {
  member_uuid: string
  user_id: string
  contract_type: ContractType
  hire_date: string
  termination_date: string
  weekly_hours: string
  annual_work_hours: string
  current_leave_balance: string
  is_active: boolean
  notes: string
}

const defaultForm: ProfileFormState = {
  member_uuid: '',
  user_id: '',
  contract_type: 'CDI',
  hire_date: '',
  termination_date: '',
  weekly_hours: '35.00',
  annual_work_hours: '1607.00',
  current_leave_balance: '0',
  is_active: true,
  notes: '',
}

function profileToForm(p: HrEmployeeProfile): ProfileFormState {
  return {
    member_uuid: p.member_uuid,
    user_id: p.user_id?.toString() ?? '',
    contract_type: p.contract_type,
    hire_date: p.hire_date,
    termination_date: p.termination_date ?? '',
    weekly_hours: p.weekly_hours,
    annual_work_hours: p.annual_work_hours,
    current_leave_balance: p.current_leave_balance,
    is_active: p.is_active,
    notes: p.notes ?? '',
  }
}

export function TeamProfilesPage() {
  const { t } = useTranslation('rh')

  const [activeOnly, setActiveOnly] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingUuid, setEditingUuid] = useState<string | null>(null)
  const [form, setForm] = useState<ProfileFormState>(defaultForm)

  const { data: profiles = [], isLoading } = useHrProfiles(activeOnly)
  const createMutation = useCreateHrProfile()
  const updateMutation = useUpdateHrProfile()

  function openCreate() {
    setEditingUuid(null)
    setForm(defaultForm)
    setSheetOpen(true)
  }

  function openEdit(profile: HrEmployeeProfile) {
    setEditingUuid(profile.member_uuid)
    setForm(profileToForm(profile))
    setSheetOpen(true)
  }

  function handleField(field: keyof ProfileFormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      member_uuid: form.member_uuid || undefined,
      user_id: form.user_id ? parseInt(form.user_id) : null,
      contract_type: form.contract_type,
      hire_date: form.hire_date,
      termination_date: form.termination_date || null,
      weekly_hours: form.weekly_hours,
      annual_work_hours: form.annual_work_hours,
      current_leave_balance: form.current_leave_balance,
      is_active: form.is_active,
      notes: form.notes || null,
    }

    try {
      if (editingUuid) {
        await updateMutation.mutateAsync({ memberUuid: editingUuid, data: payload })
        toast.success(t('profile.edit') + ' — OK')
      } else {
        await createMutation.mutateAsync(payload)
        toast.success(t('profile.add') + ' — OK')
      }
      setSheetOpen(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erreur')
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch
            id="active-only"
            checked={activeOnly}
            onCheckedChange={setActiveOnly}
          />
          <Label htmlFor="active-only">{t('profile.active_only')}</Label>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('profile.add')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-4">{t('common:loading', 'Chargement...')}</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t('profile.no_results')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('members:lastName', 'Nom')}</TableHead>
                <TableHead>{t('members:firstName', 'Prénom')}</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Tri</TableHead>
                <TableHead>{t('profile.fields.contract_type')}</TableHead>
                <TableHead>{t('profile.fields.hire_date')}</TableHead>
                <TableHead>{t('profile.fields.weekly_hours')}</TableHead>
                <TableHead>{t('profile.fields.annual_work_hours')}</TableHead>
                <TableHead>{t('profile.fields.current_leave_balance')}</TableHead>
                <TableHead>{t('profile.fields.is_active')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p: HrEmployeeProfile) => (
                <TableRow key={p.member_uuid}>
                  <TableCell className="font-medium">{p.member_last_name ?? '—'}</TableCell>
                  <TableCell>{p.member_first_name ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.member_account_id ?? '—'}</TableCell>
                  <TableCell className="text-xs font-mono">{p.member_trigram ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(`profile.contract_types.${p.contract_type}`, p.contract_type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{p.hire_date}</TableCell>
                  <TableCell className="text-sm text-right">{p.weekly_hours}h</TableCell>
                  <TableCell className="text-sm text-right">{p.annual_work_hours}h</TableCell>
                  <TableCell className="text-sm text-right">{p.current_leave_balance}j</TableCell>
                  <TableCell>
                    <Badge className={p.is_active ? 'badge-success' : 'badge-destructive'}>
                      {p.is_active ? 'Actif' : 'Inactif'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(p)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editingUuid ? t('profile.edit') : t('profile.add')}
            </SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {!editingUuid && (
              <div className="space-y-1">
                <Label>UUID membre</Label>
                <Input
                  value={form.member_uuid}
                  onChange={(e) => handleField('member_uuid', e.target.value)}
                  placeholder="UUID du membre"
                  required
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>{t('profile.fields.contract_type')}</Label>
              <Select
                value={form.contract_type}
                onValueChange={(v) => handleField('contract_type', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>
                      {t(`profile.contract_types.${ct}`, ct)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('profile.fields.hire_date')}</Label>
                <Input
                  type="date"
                  value={form.hire_date}
                  onChange={(e) => handleField('hire_date', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>{t('profile.fields.termination_date')}</Label>
                <Input
                  type="date"
                  value={form.termination_date}
                  onChange={(e) => handleField('termination_date', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('profile.fields.weekly_hours')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.weekly_hours}
                  onChange={(e) => handleField('weekly_hours', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>{t('profile.fields.annual_work_hours')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.annual_work_hours}
                  onChange={(e) => handleField('annual_work_hours', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>{t('profile.fields.current_leave_balance')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.current_leave_balance}
                onChange={(e) => handleField('current_leave_balance', e.target.value)}
                required
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="profile-active"
                checked={form.is_active}
                onCheckedChange={(v) => handleField('is_active', v)}
              />
              <Label htmlFor="profile-active">{t('profile.fields.is_active')}</Label>
            </div>

            <div className="space-y-1">
              <Label>{t('profile.fields.notes')}</Label>
              <Input
                value={form.notes}
                onChange={(e) => handleField('notes', e.target.value)}
                placeholder="Notes optionnelles"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSheetOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
