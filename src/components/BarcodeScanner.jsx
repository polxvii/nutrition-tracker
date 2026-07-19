import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { Button, Input } from './ui'

// Live barcode scanner. Opens the back camera, decodes any 1D/2D barcode and
// fires onDetected(code) once. Requires a secure context (HTTPS / localhost).
export default function BarcodeScanner({ onDetected, onCancel }) {
  const videoRef = useRef(null)
  const detectedRef = useRef(onDetected)
  detectedRef.current = onDetected
  const [error, setError] = useState(null)
  const [manual, setManual] = useState('')

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    let controls
    let done = false
    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current,
        (result, _err, ctrl) => {
          controls = ctrl
          if (done || !result) return
          done = true
          ctrl.stop()
          detectedRef.current(result.getText())
        }
      )
      .then((ctrl) => (controls = ctrl))
      .catch((e) =>
        setError(
          e?.name === 'NotAllowedError'
            ? 'Camera permission denied.'
            : e?.message || 'Cannot access the camera.'
        )
      )
    return () => {
      done = true
      try {
        controls?.stop()
      } catch {
        /* already stopped */
      }
    }
  }, [])

  return (
    <div className="space-y-2">
      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <div className="overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="h-60 w-full object-cover" muted playsInline />
        </div>
      )}
      <p className="text-center text-xs text-slate-500">
        Point the camera at a product barcode
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const c = manual.trim()
          if (c) detectedRef.current(c)
        }}
        className="flex gap-2"
      >
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Or type the barcode number"
          inputMode="numeric"
          className="flex-1"
        />
        <Button type="submit" variant="ghost" disabled={!manual.trim()}>
          Look up
        </Button>
      </form>

      <Button variant="ghost" className="w-full" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
