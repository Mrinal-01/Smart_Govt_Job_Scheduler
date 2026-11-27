import { Component, type ReactNode } from 'react'
import { Button } from './ui'

/**
 * Keeps one broken page from blanking the whole app: the sidebar and header stay usable
 * and the student sees what happened. Reset by remounting with a new `key` (the route).
 */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Page crashed:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="page">
        <div className="callout callout--danger section" role="alert">
          <span>This page hit an unexpected error: {this.state.error.message}. Open another tab from the menu, or reload the app.</span>
        </div>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload app
        </Button>
      </main>
    )
  }
}
