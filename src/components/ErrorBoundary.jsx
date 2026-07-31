import { Component } from 'react'

// A failed dynamic import almost always means a new version deployed and the
// old lazy chunk (e.g. the barcode scanner) is gone — the fix is to reload and
// pick up the fresh app.
const isChunkError = (e) =>
  /dynamically imported module|module script failed|Loading chunk|ChunkLoadError|error loading dynamically/i.test(
    (e && (e.message || String(e))) || ''
  )

// Catches render/lazy-load errors so a broken chunk shows a Reload prompt
// instead of a blank white screen. On a chunk error it reloads automatically
// (throttled, so it can't loop).
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    if (isChunkError(error)) {
      const last = Number(sessionStorage.getItem('cf-reload-at') || 0)
      if (Date.now() - last > 10000) {
        sessionStorage.setItem('cf-reload-at', String(Date.now()))
        window.location.reload()
      }
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="mx-auto max-w-md p-6 text-center text-sm text-slate-300">
          <p className="mb-3">Something went wrong loading this screen.</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-500"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
