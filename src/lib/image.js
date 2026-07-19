// Read a photo File, downscale it (keeps the request small + cheaper to
// analyse), and return base64 JPEG data plus a preview data URL.

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

export async function fileToAnalyzableImage(file, maxEdge = 1080, quality = 0.85) {
  const dataUrl = await readAsDataURL(file)
  const img = await loadImage(dataUrl)

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(img, 0, 0, width, height)

  const jpegDataUrl = canvas.toDataURL('image/jpeg', quality)
  return {
    base64: jpegDataUrl.split(',')[1],
    mediaType: 'image/jpeg',
    previewUrl: jpegDataUrl,
  }
}
