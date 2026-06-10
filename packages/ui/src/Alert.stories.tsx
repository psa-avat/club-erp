import type { Meta, StoryObj } from '@storybook/react'
import { Alert } from './alert'

const meta: Meta<typeof Alert> = {
  title: 'Primitives/Alert',
  component: Alert,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['error', 'success', 'warning', 'info'],
    },
  },
  args: {
    children: 'This is an alert message.',
    variant: 'info',
  },
}

export default meta
type Story = StoryObj<typeof Alert>

export const Info: Story = { args: { variant: 'info' } }

export const Success: Story = { args: { variant: 'success', children: 'Operation completed successfully.' } }

export const Warning: Story = { args: { variant: 'warning', children: 'Please review your input before submitting.' } }

export const Error: Story = { args: { variant: 'error', children: 'An error occurred while saving the record.' } }
