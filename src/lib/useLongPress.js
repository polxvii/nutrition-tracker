import { useRef } from 'react'

// Press-and-hold to fire `onLongPress` (e.g. enter multi-select). Pointer events
// cover mouse + touch; a small move cancels the hold so it doesn't fight
// scrolling / swiping. Returns only the pointer handlers — the caller owns the
// click (and, if it wants, suppresses the click that follows a fired hold).
export function useLongPress(onLongPress, { delay = 450 } = {}) {
  const timer = useRef(null)
  const startPt = useRef(null)

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  return {
    onPointerDown: (e) => {
      startPt.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = setTimeout(() => onLongPress?.(), delay)
    },
    onPointerMove: (e) => {
      if (!startPt.current) return
      if (Math.abs(e.clientX - startPt.current.x) > 10 || Math.abs(e.clientY - startPt.current.y) > 10) clear()
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
  }
}
