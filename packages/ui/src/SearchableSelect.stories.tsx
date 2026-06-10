import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { SearchableSelect } from '@/components/ui/searchable-select'

const fruits = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'date', label: 'Date' },
  { value: 'elderberry', label: 'Elderberry' },
  { value: 'fig', label: 'Fig' },
  { value: 'grape', label: 'Grape' },
]

const meta: Meta<typeof SearchableSelect> = {
  title: 'Primitives/SearchableSelect',
  component: SearchableSelect,
  tags: ['autodocs'],
  args: {
    options: fruits,
    placeholder: 'Select a fruit…',
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value ?? '')
    return <SearchableSelect {...args} value={value} onChange={setValue} />
  },
}

export default meta
type Story = StoryObj<typeof SearchableSelect>

export const Default: Story = {}

export const WithClear: Story = {
  args: { clearable: true },
}

export const WithPreselected: Story = {
  args: { value: 'banana' },
}
