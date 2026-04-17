import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  useAdminCapabilitiesQuery,
  useAdminRolesQuery,
  useAdminUsersQuery,
  useCreateAdminCapabilityMutation,
  useCreateAdminRoleMutation,
  useCreateAdminUserMutation,
  useDeleteAdminCapabilityMutation,
  useDeleteAdminRoleMutation,
  useDeleteAdminUserMutation,
  useUpdateAdminCapabilityMutation,
  useUpdateAdminRoleMutation,
  useUpdateAdminUserMutation,
} from '../api'

type AdminTab = 'users' | 'roles' | 'capabilities'

function parseCsvList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: string } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }

    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string }
      if (typeof first?.msg === 'string' && first.msg.length > 0) {
        return first.msg
      }
    }

    if (typeof response?.data?.message === 'string' && response.data.message.length > 0) {
      return response.data.message
    }
  }
  return 'Unexpected error'
}

export function AdminPage() {
  const { t } = useTranslation('admin')
  const [activeTab, setActiveTab] = useState<AdminTab>('users')

  const usersQuery = useAdminUsersQuery()
  const rolesQuery = useAdminRolesQuery()
  const capabilitiesQuery = useAdminCapabilitiesQuery()

  const users = usersQuery.data ?? []
  const roles = rolesQuery.data ?? []
  const capabilities = capabilitiesQuery.data ?? []

  const loading = usersQuery.isLoading || rolesQuery.isLoading || capabilitiesQuery.isLoading
  const loadingError = usersQuery.error ?? rolesQuery.error ?? capabilitiesQuery.error

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('management.title')}</h1>
        <p className="text-sm text-slate-600">{t('management.description')}</p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">
        <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')}>
          {t('tabs.users')}
        </TabButton>
        <TabButton active={activeTab === 'roles'} onClick={() => setActiveTab('roles')}>
          {t('tabs.roles')}
        </TabButton>
        <TabButton active={activeTab === 'capabilities'} onClick={() => setActiveTab('capabilities')}>
          {t('tabs.capabilities')}
        </TabButton>
      </div>

      {loading ? <p className="text-sm text-slate-600">{t('loading')}</p> : null}

      {loadingError ? <Alert>{toErrorMessage(loadingError)}</Alert> : null}

      {!loading && !loadingError ? (
        <>
          {activeTab === 'users' ? (
            <UsersCrudPanel
              roles={roles.map((role) => role.slug)}
              users={users}
            />
          ) : null}

          {activeTab === 'roles' ? (
            <RolesCrudPanel
              capabilityCodes={capabilities.map((capability) => capability.code)}
              roles={roles}
            />
          ) : null}

          {activeTab === 'capabilities' ? <CapabilitiesCrudPanel capabilities={capabilities} /> : null}
        </>
      ) : null}
    </section>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: string
  onClick: () => void
}) {
  return (
    <button
      className={[
        'rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
      ].join(' ')}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function UsersCrudPanel({ roles, users }: { users: ReturnType<typeof useAdminUsersQuery>['data']; roles: string[] }) {
  const { t } = useTranslation('admin')
  const createUserMutation = useCreateAdminUserMutation()
  const updateUserMutation = useUpdateAdminUserMutation()
  const deleteUserMutation = useDeleteAdminUserMutation()

  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [prenom, setPrenom] = useState('')
  const [nom, setNom] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [roleSlugsInput, setRoleSlugsInput] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null)

  const combinedError = createUserMutation.error ?? updateUserMutation.error ?? deleteUserMutation.error

  function resetForm() {
    setEditingUserId(null)
    setEmail('')
    setPassword('')
    setPrenom('')
    setNom('')
    setIsActive(true)
    setRoleSlugsInput('')
  }

  function startEdit(userId: number) {
    const user = (users ?? []).find((item) => item.id === userId)
    if (!user) {
      return
    }

    setEditingUserId(user.id)
    setEmail(user.email)
    setPassword('')
    setPrenom(user.prenom ?? '')
    setNom(user.nom ?? '')
    setIsActive(user.is_active)
    setRoleSlugsInput(user.roles.join(', '))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const payload = {
      email,
      prenom: prenom || undefined,
      nom: nom || undefined,
      is_active: isActive,
      role_slugs: parseCsvList(roleSlugsInput),
      ...(password ? { password } : {}),
    }

    if (editingUserId !== null) {
      await updateUserMutation.mutateAsync({ userId: editingUserId, payload })
    } else {
      await createUserMutation.mutateAsync({ ...payload, password })
    }

    resetForm()
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return
    }

    await deleteUserMutation.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-6">
      <form className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="user-email">{t('users.email')}</Label>
          <Input id="user-email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-password">{t('users.password')}</Label>
          <Input
            id="user-password"
            placeholder={editingUserId ? t('users.passwordOptional') : ''}
            minLength={8}
            required={editingUserId === null}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-prenom">{t('users.prenom')}</Label>
          <Input id="user-prenom" value={prenom} onChange={(event) => setPrenom(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-nom">{t('users.nom')}</Label>
          <Input id="user-nom" value={nom} onChange={(event) => setNom(event.target.value)} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="user-roles">{t('users.roleSlugs')}</Label>
          <Input
            id="user-roles"
            placeholder={roles.join(', ')}
            value={roleSlugsInput}
            onChange={(event) => setRoleSlugsInput(event.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
          <input checked={isActive} type="checkbox" onChange={(event) => setIsActive(event.target.checked)} />
          {t('users.active')}
        </label>
        <div className="flex gap-2 md:col-span-2">
          <Button disabled={createUserMutation.isPending || updateUserMutation.isPending} type="submit">
            {editingUserId ? t('actions.update') : t('actions.create')}
          </Button>
          {editingUserId ? (
            <Button type="button" variant="secondary" onClick={resetForm}>
              {t('actions.cancel')}
            </Button>
          ) : null}
        </div>
      </form>

      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      <CrudTable
        columns={[
          t('users.email'),
          t('users.name'),
          t('users.active'),
          t('users.roles'),
          t('actions.title'),
        ]}
        rows={(users ?? []).map((user) => [
          user.email,
          `${user.prenom ?? ''} ${user.nom ?? ''}`.trim() || '-',
          user.is_active ? t('states.yes') : t('states.no'),
          user.roles.join(', ') || '-',
          <div className="flex gap-2" key={`actions-${user.id}`}>
            <Button size="sm" type="button" variant="secondary" onClick={() => startEdit(user.id)}>
              {t('actions.edit')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="destructive"
              onClick={() => setDeleteTarget({ id: user.id, label: user.email })}
            >
              {t('actions.delete')}
            </Button>
          </div>,
        ])}
      />

      <ConfirmDeleteDialog
        busy={deleteUserMutation.isPending}
        description={t('actions.confirmMessage', { label: deleteTarget?.label ?? '' })}
        open={deleteTarget !== null}
        title={t('actions.confirmTitle')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          void confirmDelete()
        }}
      />
    </div>
  )
}

function RolesCrudPanel({
  capabilityCodes,
  roles,
}: {
  capabilityCodes: string[]
  roles: ReturnType<typeof useAdminRolesQuery>['data']
}) {
  const { t } = useTranslation('admin')
  const createRoleMutation = useCreateAdminRoleMutation()
  const updateRoleMutation = useUpdateAdminRoleMutation()
  const deleteRoleMutation = useDeleteAdminRoleMutation()

  const [editingRoleId, setEditingRoleId] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [capabilityCodesInput, setCapabilityCodesInput] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null)

  const combinedError = createRoleMutation.error ?? updateRoleMutation.error ?? deleteRoleMutation.error

  function resetForm() {
    setEditingRoleId(null)
    setCode('')
    setSlug('')
    setName('')
    setIsActive(true)
    setCapabilityCodesInput('')
  }

  function startEdit(roleId: number) {
    const role = (roles ?? []).find((item) => item.id === roleId)
    if (!role) {
      return
    }

    setEditingRoleId(role.id)
    setCode(String(role.code))
    setSlug(role.slug)
    setName(role.name)
    setIsActive(role.is_active)
    setCapabilityCodesInput(role.capabilities.join(', '))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const payload = {
      code: Number(code),
      slug,
      name,
      is_active: isActive,
      capability_codes: parseCsvList(capabilityCodesInput),
    }

    if (editingRoleId !== null) {
      await updateRoleMutation.mutateAsync({ roleId: editingRoleId, payload })
    } else {
      await createRoleMutation.mutateAsync(payload)
    }

    resetForm()
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return
    }

    await deleteRoleMutation.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-6">
      <form className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="role-code">{t('roles.code')}</Label>
          <Input id="role-code" required type="number" value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role-slug">{t('roles.slug')}</Label>
          <Input id="role-slug" required value={slug} onChange={(event) => setSlug(event.target.value)} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="role-name">{t('roles.name')}</Label>
          <Input id="role-name" required value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="role-capabilities">{t('roles.capabilities')}</Label>
          <Input
            id="role-capabilities"
            placeholder={capabilityCodes.join(', ')}
            value={capabilityCodesInput}
            onChange={(event) => setCapabilityCodesInput(event.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
          <input checked={isActive} type="checkbox" onChange={(event) => setIsActive(event.target.checked)} />
          {t('roles.active')}
        </label>
        <div className="flex gap-2 md:col-span-2">
          <Button disabled={createRoleMutation.isPending || updateRoleMutation.isPending} type="submit">
            {editingRoleId ? t('actions.update') : t('actions.create')}
          </Button>
          {editingRoleId ? (
            <Button type="button" variant="secondary" onClick={resetForm}>
              {t('actions.cancel')}
            </Button>
          ) : null}
        </div>
      </form>

      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      <CrudTable
        columns={[
          t('roles.code'),
          t('roles.slug'),
          t('roles.name'),
          t('roles.active'),
          t('roles.capabilities'),
          t('actions.title'),
        ]}
        rows={(roles ?? []).map((role) => [
          String(role.code),
          role.slug,
          role.name,
          role.is_active ? t('states.yes') : t('states.no'),
          role.capabilities.join(', ') || '-',
          <div className="flex gap-2" key={`actions-${role.id}`}>
            <Button size="sm" type="button" variant="secondary" onClick={() => startEdit(role.id)}>
              {t('actions.edit')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="destructive"
              onClick={() => setDeleteTarget({ id: role.id, label: role.name })}
            >
              {t('actions.delete')}
            </Button>
          </div>,
        ])}
      />

      <ConfirmDeleteDialog
        busy={deleteRoleMutation.isPending}
        description={t('actions.confirmMessage', { label: deleteTarget?.label ?? '' })}
        open={deleteTarget !== null}
        title={t('actions.confirmTitle')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          void confirmDelete()
        }}
      />
    </div>
  )
}

function CapabilitiesCrudPanel({
  capabilities,
}: {
  capabilities: ReturnType<typeof useAdminCapabilitiesQuery>['data']
}) {
  const { t } = useTranslation('admin')
  const createCapabilityMutation = useCreateAdminCapabilityMutation()
  const updateCapabilityMutation = useUpdateAdminCapabilityMutation()
  const deleteCapabilityMutation = useDeleteAdminCapabilityMutation()

  const [editingCapabilityId, setEditingCapabilityId] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null)

  const combinedError =
    createCapabilityMutation.error ?? updateCapabilityMutation.error ?? deleteCapabilityMutation.error

  function resetForm() {
    setEditingCapabilityId(null)
    setCode('')
    setName('')
    setDescription('')
  }

  function startEdit(capabilityId: number) {
    const capability = (capabilities ?? []).find((item) => item.id === capabilityId)
    if (!capability) {
      return
    }

    setEditingCapabilityId(capability.id)
    setCode(capability.code)
    setName(capability.name)
    setDescription(capability.description ?? '')
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = { code, name, description: description || undefined }

    if (editingCapabilityId !== null) {
      await updateCapabilityMutation.mutateAsync({ capabilityId: editingCapabilityId, payload })
    } else {
      await createCapabilityMutation.mutateAsync(payload)
    }

    resetForm()
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return
    }

    await deleteCapabilityMutation.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-6">
      <form className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="capability-code">{t('capabilities.code')}</Label>
          <Input id="capability-code" required value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="capability-name">{t('capabilities.name')}</Label>
          <Input id="capability-name" required value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="capability-description">{t('capabilities.description')}</Label>
          <Input
            id="capability-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="flex gap-2 md:col-span-2">
          <Button disabled={createCapabilityMutation.isPending || updateCapabilityMutation.isPending} type="submit">
            {editingCapabilityId ? t('actions.update') : t('actions.create')}
          </Button>
          {editingCapabilityId ? (
            <Button type="button" variant="secondary" onClick={resetForm}>
              {t('actions.cancel')}
            </Button>
          ) : null}
        </div>
      </form>

      {combinedError ? <Alert>{toErrorMessage(combinedError)}</Alert> : null}

      <CrudTable
        columns={[
          t('capabilities.code'),
          t('capabilities.name'),
          t('capabilities.description'),
          t('actions.title'),
        ]}
        rows={(capabilities ?? []).map((capability) => [
          capability.code,
          capability.name,
          capability.description || '-',
          <div className="flex gap-2" key={`actions-${capability.id}`}>
            <Button size="sm" type="button" variant="secondary" onClick={() => startEdit(capability.id)}>
              {t('actions.edit')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="destructive"
              onClick={() => setDeleteTarget({ id: capability.id, label: capability.code })}
            >
              {t('actions.delete')}
            </Button>
          </div>,
        ])}
      />

      <ConfirmDeleteDialog
        busy={deleteCapabilityMutation.isPending}
        description={t('actions.confirmMessage', { label: deleteTarget?.label ?? '' })}
        open={deleteTarget !== null}
        title={t('actions.confirmTitle')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          void confirmDelete()
        }}
      />
    </div>
  )
}

function ConfirmDeleteDialog({
  busy,
  description,
  open,
  title,
  onCancel,
  onConfirm,
}: {
  busy: boolean
  description: string
  open: boolean
  title: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation('admin')

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <button aria-label={t('actions.cancel')} className="absolute inset-0" type="button" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button disabled={busy} type="button" variant="secondary" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
          <Button disabled={busy} type="button" variant="destructive" onClick={onConfirm}>
            {busy ? t('actions.deleting') : t('actions.confirmDelete')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function CrudTable({ columns, rows }: { columns: string[]; rows: Array<Array<string | ReactNode>> }) {
  const { t } = useTranslation('admin')
  const empty = useMemo(() => rows.length === 0, [rows.length])

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 text-left font-semibold text-slate-700">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {empty ? (
            <tr>
              <td className="px-3 py-3 text-slate-500" colSpan={columns.length}>
                {t('empty')}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`row-${index}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${index}-${cellIndex}`} className="px-3 py-2 text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
