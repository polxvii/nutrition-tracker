import { useRef } from 'react'

// Press-and-hold to fire `onLongPress` (e.g. enter multi-select), while a normal
// tap still runs `onClick`. Pointer events cover mouse + touch; a small move
// cancels the hold (so it doesn't fight scrolling / swiping). After a long press
// fires we swallow the click that the browser sends on release, so the hold
// doesn't also count as a tap. `enabled: false` disables the hold (tap only).
export function useLongPress(onLongPress, { onClick, delay = 450, enabled = true } = {}) {
  const timer = useRef(null)
  const fired = useRef(false)
  const startPt = useRef(null)

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  return {
    onPointerDown: (e) => {
      fired.current = false
      if (!enabled) return
      startPt.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = setTimeout(() => {
        fired.current = true
        onLongPress?.()
      }, delay)
    },
    onPointerMove: (e) => {
      if (!startPt.current) return
      if (Math.abs(e.clientX - startPt.current.x) > 10 || Math.abs(e.clientY - startPt.current.y) > 10) clear()
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: (e) => {
      if (fired.current) {
        fired.current = false
        e.preventDefault()
        e.stopPropagation()
        return
      }
      onClick?.(e)
    },
  }
}
