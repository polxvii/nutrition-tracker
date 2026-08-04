import { useRef } from 'react'

// Swipe a row left to reveal Copy / Delete. During a drag we move the DOM node
// imperatively (no React re-render per touchmove — that was the janky part) and
// stop touch propagation so the page's day-swipe doesn't also fire. A plain tap
// (no drag) passes straight through to the row's own handlers.
export default function SwipeRow({ onDuplicate, onDelete, children }) {
  const REVEAL = 128 // width of the two action buttons
  const el = useRef(null)
  const dx = useRef(0)
  const start = useRef(null)
  const dragging = useRef(false)

  function setX(x, animate) {
    const n = el.current
    if (!n) return
    n.style.transition = animate ? 'transform 0.2s ease' : 'none'
    n.style.transform = `translateX(${x}px)`
    dx.current = x
  }
  function onTouchStart(e) {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, base: dx.current }
    dragging.current = false
  }
  function onTouchMove(e) {
    const s = start.current
    if (!s) return
    const t = e.touches[0]
    const mx = t.clientX - s.x
    const my = t.clientY - s.y
    if (!dragging.current) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
      if (Math.abs(my) > Math.abs(mx)) {
        start.current = null // vertical → let it scroll
        return
      }
      dragging.current = true
    }
    e.stopPropagation()
    setX(Math.max(-REVEAL, Math.min(0, s.base + mx)), false)
  }
  function onTouchEnd(e) {
    const s = start.current
    const wasDrag = dragging.current
    start.current = null
    dragging.current = false
    if (!s || !wasDrag) return
    e.stopPropagation()
    setX(dx.current < -REVEAL / 2 ? -REVEAL : 0, true)
  }
  const close = () => setX(0, true)

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className="absolute inset-y-0 right-0 flex">
        <button
          onClick={() => {
            close()
            onDuplicate?.()
          }}
          className="flex w-16 items-center justify-center bg-slate-700 text-xs font-medium text-white active:bg-slate-600"
        >
          Copy
        </button>
        <button
          onClick={() => {
            close()
            onDelete?.()
          }}
          className="flex w-16 items-center justify-center bg-red-600 text-xs font-medium text-white active:bg-red-700"
        >
          Delete
        </button>
      </div>
      <div ref={el} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {children}
      </div>
    </div>
  )
}
