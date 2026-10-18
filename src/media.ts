import { UserFacingError } from './domain/errors'
export async function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () =>
      reject(new UserFacingError('This file could not be read. Please try another file.'))
    reader.readAsDataURL(file)
  })
}
export async function preparePhoto(file: File): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new UserFacingError('Choose a photo smaller than 15 MB.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new UserFacingError(
      'Choose a JPEG, PNG or WebP photo. Convert HEIC photos to JPEG first.',
    )
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () =>
        reject(new UserFacingError('This photo could not be opened. Try a different image.'))
      image.src = url
    })
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new UserFacingError('Photo processing is unavailable in this browser.')
    ctx.fillStyle = '#fffdf9'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}
