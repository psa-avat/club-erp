import type { Meta, StoryObj } from '@storybook/react'
import { DataTable } from '@/components/ui/data-table'
import type { ColumnDef } from '@/components/ui/data-table'

interface SampleRow {
  id: number
  name: string
  email: string
  role: string
}

const columns: ColumnDef<SampleRow>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, sortable: true },
  { key: 'email', header: 'Email', cell: (r) => r.email, sortable: true },
  { key: 'role', header: 'Role', cell: (r) => r.role },
]

const sampleData: SampleRow[] = [
  { id: 1, name: 'Alice Dupont', email: 'alice@example.com', role: 'Admin' },
  { id: 2, name: 'Bob Martin', email: 'bob@example.com', role: 'Staff' },
  { id: 3, name: 'Charlie Durand', email: 'charlie@example.com', role: 'Member' },
]

const meta: Meta<typeof DataTable<SampleRow>> = {
  title: 'Primitives/DataTable',
  component: DataTable<SampleRow>,
  tags: ['autodocs'],
  args: {
    columns,
    data: sampleData,
    getRowKey: (r) => r.id,
    defaultSortKey: 'name',
  },
}

export default meta
type Story = StoryObj<typeof DataTable<SampleRow>>

export const Default: Story = {}

export const WithRowClick: Story = {
  args: {
    onRowClick: (row) => alert(`Clicked row ${row.id}`),
  },
}

export const WithActions: Story = {
  args: {
    actions: (row) => (
      <button
        type="button"
        className="text-xs text-blue-600 hover:underline"
        onClick={() => alert(`Edit ${row.name}`)}
      >
        Edit
      </button>
    ),
  },
}

export const Empty: Story = {
  args: {
    data: [],
    emptyState: <div className="p-8 text-center text-sm text-slate-500">No members found</div>,
  },
}
