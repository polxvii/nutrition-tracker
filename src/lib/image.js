// Read a photo File, downscale it (keeps the request small + cheaper to
// analyse), and return base64 JPEG data plus a preview data URL.
//
// The heavy decode + encode is the source of the "upload feels laggy" jank, so
// we prefer createImageBitmap (decodes straight from the blob, off the main
// thread, and honours EXIF orientation) + canvas.toBlob (async encode). Older
// browsers fall back to the FileReader + <img> + toDataURL path.

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
}

// Decode a File to something drawImage accepts (ImageBitmap or <img>). The
// bitmap path avoids turning the full-res file into a giant base64 string first.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Some formats (older Safari, odd files) reject — fall back below.
    }
  }
  return loadImage(await readAsDataURL(file))
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality)
    } else {
      // Ancient fallback: sync encode, then turn the data URL into a blob.
      fetch(canvas.toDataURL('image/jpeg', quality)).then((r) => r.blob()).then(resolve, reject)
    }
  })
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function fileToAnalyzableImage(file, maxEdge = 900, quality = 0.8) {
  const src = await decodeImage(file)
  const iw = src.width
  const ih = src.height

  const scale = Math.min(1, maxEdge / Math.max(iw, ih))
  const width = Math.round(iw * scale)
  const height = Math.round(ih * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(src, 0, 0, width, height)
  if (typeof src.close === 'function') src.close() // free the ImageBitmap early

  const blob = await canvasToBlob(canvas, quality)
  const base64 = await blobToBase64(blob)
  return {
    base64,
    mediaType: 'image/jpeg',
    // Preview is the already-downscaled JPEG (small), so a data URL is fine and
    // needs no object-URL bookkeeping.
    previewUrl: `data:image/jpeg;base64,${base64}`,
  }
}
