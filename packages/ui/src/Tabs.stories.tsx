import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Tabs } from '@/components/ui/tabs'

const meta: Meta<typeof Tabs> = {
  title: 'Primitives/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  argTypes: {
    activeKey: { control: 'text' },
  },
  args: {
    items: [
      { key: 'tab1', label: 'Tab 1' },
      { key: 'tab2', label: 'Tab 2' },
      { key: 'tab3', label: 'Tab 3 (disabled)', disabled: true },
      { key: 'tab4', label: 'Tab 4' },
    ],
    activeKey: 'tab1',
  },
  render: function Render(args) {
    const [active, setActive] = useState(args.activeKey)
    return <Tabs {...args} activeKey={active} onChange={setActive} />
  },
}

export default meta
type Story = StoryObj<typeof Tabs>

export const Default: Story = {}

export const TwoTabs: Story = {
  args: {
    items: [
      { key: 'a', label: 'Active' },
      { key: 'b', label: 'Archived' },
    ],
    activeKey: 'a',
  },
}
