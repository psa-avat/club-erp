/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Recap message template management (CRUD) — capability-gated admin screen
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
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { ConfirmDialog } from '../../../components/ui/confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table'
import { useCapability } from '../../../auth/hooks/useCapability'
import {
  useCreateRecapMessageTemplateMutation,
  useDeleteRecapMessageTemplateMutation,
  useRecapMessageTemplatesQuery,
  useUpdateRecapMessageTemplateMutation,
} from '../api'
import type { MemberRecapMessageTemplate } from '../types'
import { toErrorMessage } from './membersShared'

type FormState = { label: string; body: string }

const EMPTY_FORM: FormState = { label: '', body: '' }

export function MemberRecapTemplatesPage() {
  const canManage = useCapability('SEND_MEMBER_EMAILS')

  if (!canManage) {
    return <Navigate replace to="/club/members/core" />
  }

  return <MemberRecapTemplatesScreen />
}

function MemberRecapTemplatesScreen() {
  const { t } = useTranslation('members')
  const templatesQuery = useRecapMessageTemplatesQuery()
  const templates = templatesQuery.data ?? []

  const createMutation = useCreateRecapMessageTemplateMutation()
  const updateMutation = useUpdateRecapMessageTemplateMutation()
  const deleteMutation = useDeleteRecapMessageTemplateMutation()

  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<MemberRecapMessageTemplate | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [confirmDeleteUuid, setConfirmDeleteUuid] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  function openNewTemplate() {
    setEditingTemplate(null)
    setForm(EMPTY_FORM)
    setLocalError(null)
    setIsEditorOpen(true)
  }

  function openEditTemplate(template: MemberRecapMessageTemplate) {
    setEditingTemplate(template)
    setForm({ label: template.label, body: template.body })
    setLocalError(null)
    setIsEditorOpen(true)
  }

  async function handleSave() {
    setLocalError(null)
    try {
      if (editingTemplate) {
        await updateMutation.mutateAsync({
          templateUuid: editingTemplate.uuid,
          payload: { label: form.label.trim(), body: form.body },
        })
        toast.success(t('recapEmail.templates.saved'))
      } else {
        await createMutation.mutateAsync({ label: form.label.trim(), body: form.body })
        toast.success(t('recapEmail.templates.saved'))
      }
      setIsEditorOpen(false)
    } catch (error) {
      setLocalError(toErrorMessage(error))
    }
  }

  async function handleDelete(templateUuid: string) {
    try {
      await deleteMutation.mutateAsync(templateUuid)
      toast.success(t('recapEmail.templates.deleted'))
    } catch (error) {
      toast.error(toErrorMessage(error))
    } finally {
      setConfirmDeleteUuid(null)
    }
  }

  const canSave = form.label.trim() !== '' && form.body.trim() !== ''

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4">
      <ConfirmDialog
        open={confirmDeleteUuid !== null}
        title={t('recapEmail.templates.confirmDeleteTitle')}
        variant="destructive"
        confirmLabel={t('recapEmail.templates.delete')}
        onConfirm={() => { if (confirmDeleteUuid) void handleDelete(confirmDeleteUuid) }}
        onCancel={() => setConfirmDeleteUuid(null)}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('recapEmail.templates.title')}</h1>
        <Button onClick={openNewTemplate}>
          <Plus className="mr-2 h-4 w-4" />
          {t('recapEmail.templates.new')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('recapEmail.templates.listTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {templatesQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">{t('recapEmail.templates.loading')}</div>
          ) : templates.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">{t('recapEmail.templates.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('recapEmail.templates.label')}</TableHead>
                  <TableHead>{t('recapEmail.templates.body')}</TableHead>
                  <TableHead className="text-right">{t('recapEmail.templates.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.uuid}>
                    <TableCell className="font-medium">{template.label}</TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">
                      {template.body}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEditTemplate(template)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteUuid(template.uuid)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditorOpen} onOpenChange={(open) => { if (!open) setIsEditorOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? t('recapEmail.templates.editTitle') : t('recapEmail.templates.new')}
            </DialogTitle>
          </DialogHeader>

          {localError && <Alert>{localError}</Alert>}

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('recapEmail.templates.label')}</Label>
              <Input
                value={form.label}
                onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('recapEmail.templates.body')}</Label>
              <textarea
                className="min-h-32 w-full rounded-shape-sm border border-outline bg-surface px-3 py-2 text-sm text-on-surface shadow-sm outline-none focus:border-primary"
                value={form.body}
                onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditorOpen(false)}>
              {t('recapEmail.cancel')}
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={!canSave || createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? t('recapEmail.sending')
                : t('recapEmail.templates.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
