import type { Meta, StoryObj } from '@storybook/react'
import { ErrorBoundary } from './ErrorBoundary'
import { Button } from './button'

const meta: Meta<typeof ErrorBoundary> = {
  title: 'Primitives/ErrorBoundary',
  component: ErrorBoundary,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ErrorBoundary>

/** Component that throws a deliberate error */
function Bomb() {
  throw new Error('💥 This is a simulated error!')
  return null
}

/**
 * Show the default fallback UI when a child component throws.
 * The "Réessayer" button resets the error boundary.
 */
export const WithError: Story = {
  render: () => (
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>
  ),
}

/** Normal content renders without error */
export const WithoutError: Story = {
  render: () => (
    <ErrorBoundary>
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        ✅ Everything is fine here.
      </div>
    </ErrorBoundary>
  ),
}

/** Custom fallback UI */
export const CustomFallback: Story = {
  render: () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-800">Custom error: {error.message}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={reset}>
            Try again
          </Button>
        </div>
      )}
    >
      <Bomb />
    </ErrorBoundary>
  ),
}
