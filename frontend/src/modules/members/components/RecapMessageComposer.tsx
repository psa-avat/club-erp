/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - members: Shared "compose recap message" dialog for single and bulk recap email sends
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

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Label } from '../../../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { useRecapMessageTemplatesQuery } from '../api'
import { toErrorMessage } from './membersShared'

type Props = {
  open: boolean
  title: string
  description?: string
  submitLabel: string
  onClose: () => void
  onSubmit: (messageText: string) => Promise<void>
}

const NO_TEMPLATE_VALUE = '__none__'

export function RecapMessageComposer({ open, title, description, submitLabel, onClose, onSubmit }: Props) {
  const { t } = useTranslation('members')
  const templatesQuery = useRecapMessageTemplatesQuery(open)
  const templates = templatesQuery.data ?? []

  const [selectedTemplateUuid, setSelectedTemplateUuid] = useState(NO_TEMPLATE_VALUE)
  const [messageText, setMessageText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setSelectedTemplateUuid(NO_TEMPLATE_VALUE)
      setMessageText('')
      setError(null)
    }
  }, [open])

  function handleTemplateChange(templateUuid: string) {
    setSelectedTemplateUuid(templateUuid)
    if (templateUuid === NO_TEMPLATE_VALUE) return
    const template = templates.find((item) => item.uuid === templateUuid)
    if (template) {
      setMessageText(template.body)
    }
  }

  async function handleSubmit() {
    setError(null)
    setIsSubmitting(true)
    try {
      await onSubmit(messageText)
      onClose()
    } catch (submitError) {
      setError(toErrorMessage(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {error && <Alert>{error}</Alert>}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('recapEmail.templatePicker')}</Label>
            <Select value={selectedTemplateUuid} onValueChange={handleTemplateChange}>
              <SelectTrigger>
                <SelectValue placeholder={t('recapEmail.templatePickerPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE_VALUE}>{t('recapEmail.noTemplate')}</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.uuid} value={template.uuid}>
                    {template.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recap-message-text" className="text-xs">
              {t('recapEmail.messageLabel')}
            </Label>
            <textarea
              id="recap-message-text"
              className="min-h-32 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-primary"
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              placeholder={t('recapEmail.messagePlaceholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('recapEmail.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isSubmitting || messageText.trim() === ''}>
            {isSubmitting ? t('recapEmail.sending') : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
