import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './button'

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'ghost', 'destructive'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg'],
    },
    disabled: { control: 'boolean' },
  },
  args: {
    children: 'Click me',
    variant: 'default',
    size: 'default',
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Default: Story = {}

export const Secondary: Story = { args: { variant: 'secondary' } }

export const Ghost: Story = { args: { variant: 'ghost' } }

export const Destructive: Story = { args: { variant: 'destructive' } }

export const Small: Story = { args: { size: 'sm', children: 'Small' } }

export const Large: Story = { args: { size: 'lg', children: 'Large' } }

export const Disabled: Story = { args: { disabled: true } }
