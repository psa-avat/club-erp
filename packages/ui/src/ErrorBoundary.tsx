import * as React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** Optional fallback UI renderer */
  fallback?: (error: Error, reset: () => void) => React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * ErrorBoundary — capture les erreurs de rendu dans l'arbre React
 * et affiche une UI de secours au lieu de planter l'application entière.
 *
 * @example
 *   <ErrorBoundary>
 *     <ExpensiveComponent />
 *   </ErrorBoundary>
 *
 *   <ErrorBoundary fallback={(err, reset) => <MyErrorPage error={err} onRetry={reset} />}>
 *     <DataTable />
 *   </ErrorBoundary>
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset)
      }

      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 p-8 text-center"
        >
          <svg
            className="h-10 w-10 text-red-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <h3 className="text-sm font-semibold text-red-800">
            Une erreur est survenue
          </h3>
          <p className="max-w-md text-xs text-red-600">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Réessayer
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export { ErrorBoundary }
