import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './button'
import { Dialog } from '@/components/ui/dialog'

const meta: Meta<typeof Dialog> = {
  title: 'Primitives/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  argTypes: {
    open: { control: 'boolean' },
  },
  args: {
    open: true,
    children: (
      <div className="p-6">
        <h2 className="text-base font-semibold text-on-surface">Dialog title</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          This is the dialog content. Press Escape or click outside to close.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => {}}>Cancel</Button>
          <Button onClick={() => {}}>Confirm</Button>
        </div>
      </div>
    ),
  },
  render: function Render(args) {
    const [open, setOpen] = useState(args.open)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <Dialog {...args} open={open} onClose={() => setOpen(false)} />
      </>
    )
  },
}

export default meta
type Story = StoryObj<typeof Dialog>

export const Default: Story = {}

export const Large: Story = {
  args: {
    className: 'max-w-2xl',
    children: (
      <div className="p-6">
        <h2 className="text-base font-semibold text-on-surface">Large Dialog</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          A wider dialog variant for more content.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => {}}>Cancel</Button>
          <Button onClick={() => {}}>Confirm</Button>
        </div>
      </div>
    ),
  },
}
