import { useRef } from 'react'

// Horizontal-swipe detector for touch screens. Returns touch handlers to spread
// on a container. Ignores swipes that:
//  - start within `edgeGuard` px of a screen edge (so iOS back/forward-swipe
//    still works and we don't fight the browser),
//  - are mostly vertical (that's a scroll),
//  - are shorter than `threshold` px or too slow (a drag, not a flick).
export function useSwipe({ onLeft, onRight, edgeGuard = 32, threshold = 60 }) {
  const start = useRef(null)

  return {
    onTouchStart: (e) => {
      const t = e.touches[0]
      const w = window.innerWidth
      if (t.clientX < edgeGuard || t.clientX > w - edgeGuard) {
        start.current = null // near an edge → leave it to the OS
        return
      }
      start.current = { x: t.clientX, y: t.clientY, at: Date.now() }
    },
    onTouchEnd: (e) => {
      const s = start.current
      start.current = null
      if (!s) return
      const t = e.changedTouches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Math.abs(dx) < threshold) return // too small
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return // mostly vertical → scroll
      if (Date.now() - s.at > 800) return // too slow to be a flick
      if (dx < 0) onLeft?.()
      else onRight?.()
    },
  }
}
