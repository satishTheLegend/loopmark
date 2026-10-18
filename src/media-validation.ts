import { UserFacingError } from './domain/errors'
import type { Backup } from './types'

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length))
const uint32 = (bytes: Uint8Array, offset: number, little = false) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, little)

function validPng(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 8) !== '\x89PNG\r\n\x1a\n') return false
  let offset = 8,
    image = false,
    header = false
  while (offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset),
      type = ascii(bytes, offset + 4, 4)
    if (offset + 12 + length > bytes.length) return false
    if (!header) {
      if (
        type !== 'IHDR' ||
        length !== 13 ||
        !uint32(bytes, offset + 8) ||
        !uint32(bytes, offset + 12)
      )
        return false
      header = true
    }
    if (type === 'IDAT' && length > 0) image = true
    offset += 12 + length
    if (type === 'IEND') return image && length === 0 && offset === bytes.length
  }
  return false
}

function validJpeg(bytes: Uint8Array): boolean {
  if (bytes[0] !== 255 || bytes[1] !== 216) return false
  let offset = 2,
    frame = false,
    scan = false
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) return false
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 217) return frame && scan && offset === bytes.length
    if (marker === undefined || offset + 2 > bytes.length) return false
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) return false
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (
        length < 8 ||
        !((bytes[offset + 3] << 8) | bytes[offset + 4]) ||
        !((bytes[offset + 5] << 8) | bytes[offset + 6])
      )
        return false
      frame = true
    }
    offset += length
    if (marker === 218) {
      scan = true
      // Entropy-coded scan bytes contain escaped 0xff and restart markers.
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) {
          offset++
          continue
        }
        const next = bytes[offset + 1]
        if (next === 0 || (next >= 208 && next <= 215)) {
          offset += 2
          continue
        }
        break
      }
    }
  }
  return false
}

function riffChunks(bytes: Uint8Array, kind: 'WEBP' | 'WAVE'): Map<string, Uint8Array> | null {
  if (
    bytes.length < 20 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== kind ||
    uint32(bytes, 4, true) + 8 !== bytes.length
  )
    return null
  const chunks = new Map<string, Uint8Array>()
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = uint32(bytes, offset + 4, true)
    const end = offset + 8 + length
    if (end > bytes.length) return null
    chunks.set(ascii(bytes, offset, 4), bytes.subarray(offset + 8, end))
    offset = end + (length % 2)
  }
  return offset === bytes.length ? chunks : null
}

function validMp4(bytes: Uint8Array): boolean {
  let offset = 0,
    type = false,
    metadata = false,
    media = false
  while (offset + 8 <= bytes.length) {
    let length = uint32(bytes, offset)
    const tag = ascii(bytes, offset + 4, 4)
    let header = 8
    if (length === 1) {
      if (offset + 16 > bytes.length) return false
      length = uint32(bytes, offset + 8) * 2 ** 32 + uint32(bytes, offset + 12)
      header = 16
    } else if (length === 0) length = bytes.length - offset
    if (!Number.isSafeInteger(length) || length < header || offset + length > bytes.length)
      return false
    if (tag === 'ftyp' && length >= header + 8) type = true
    if (tag === 'moov' && length > header) metadata = true
    if (tag === 'mdat' && length > header) media = true
    offset += length
  }
  return offset === bytes.length && type && metadata && media
}

function validOgg(bytes: Uint8Array): boolean {
  let offset = 0,
    pages = 0,
    audio = false
  while (offset + 27 <= bytes.length) {
    if (ascii(bytes, offset, 4) !== 'OggS' || bytes[offset + 4] !== 0) return false
    const segments = bytes[offset + 26],
      start = offset + 27 + segments
    if (start > bytes.length) return false
    let length = 0
    for (let i = offset + 27; i < start; i++) length += bytes[i]
    if (start + length > bytes.length) return false
    if (pages === 0)
      audio = ['OpusHead', '\x01vorbis', 'Speex   '].some(
        (tag) => ascii(bytes, start, tag.length) === tag,
      )
    offset = start + length
    pages++
  }
  return offset === bytes.length && pages >= 2 && audio
}

function vint(bytes: Uint8Array, offset: number, identifier = false) {
  const first = bytes[offset]
  if (!first) return null
  let width = 1,
    mask = 128
  while (!(first & mask)) {
    width++
    mask >>= 1
  }
  if (width > (identifier ? 4 : 8) || offset + width > bytes.length) return null
  let value = identifier ? first : first & (mask - 1)
  let unknown = !identifier && value === mask - 1
  for (let i = 1; i < width; i++) {
    value = value * 256 + bytes[offset + i]
    unknown = unknown && bytes[offset + i] === 255
  }
  return { width, value, unknown }
}

function element(bytes: Uint8Array, offset: number, limit: number) {
  const id = vint(bytes, offset, true)
  if (!id) return null
  const size = vint(bytes, offset + id.width)
  if (!size) return null
  const start = offset + id.width + size.width
  const end = size.unknown ? limit : start + size.value
  if (!Number.isSafeInteger(end) || end > limit || end < start) return null
  return { id: id.value, start, end, unknown: size.unknown }
}

function validWebm(bytes: Uint8Array): boolean {
  const header = element(bytes, 0, bytes.length)
  if (!header || header.id !== 0x1a45dfa3 || header.unknown) return false
  let offset = header.start,
    doctype = false
  while (offset < header.end) {
    const item = element(bytes, offset, header.end)
    if (!item || item.unknown) return false
    if (item.id === 0x4282) doctype = ascii(bytes, item.start, item.end - item.start) === 'webm'
    offset = item.end
  }
  const segment = element(bytes, header.end, bytes.length)
  if (!doctype || !segment || segment.id !== 0x18538067 || segment.end !== bytes.length)
    return false
  let tracks = false,
    cluster = false
  offset = segment.start
  while (offset < segment.end) {
    const item = element(bytes, offset, segment.end)
    if (!item) return false
    // Firefox legitimately emits an empty SeekHead before Info/Tracks.
    if (item.id === 0x1654ae6b) tracks = item.end > item.start
    if (item.id === 0x1f43b675) cluster = item.end > item.start
    // Live recorder clusters can use unknown length through the end of the segment.
    if (item.unknown && item.id !== 0x1f43b675) return false
    offset = item.end
  }
  return tracks && cluster
}

export function validMedia(value: string, kind: 'photo' | 'voice'): boolean {
  // WebKit's FileReader preserves the MediaRecorder MIME's space before codecs.
  const match = /^data:([^;,]+)(?:;\s*codecs=[\w., "-]+)?;\s*base64,([A-Za-z0-9+/]*={0,2})$/.exec(
    value,
  )
  if (!match || !match[2] || match[2].length % 4 !== 0) return false
  const [, mime, payload] = match
  const allowed =
    kind === 'photo'
      ? ['image/jpeg', 'image/png', 'image/webp']
      : ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav']
  const length =
    (payload.length / 4) * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
  if (!allowed.includes(mime) || length > (kind === 'photo' ? 4 : 8) * 1024 * 1024) return false
  try {
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
    return validMediaBytes(bytes, mime, kind)
  } catch {
    return false
  }
}

/** Validate existing raw bytes without a base64 encode/decode round trip. */
export function validMediaBytes(
  bytes: Uint8Array,
  mimeType: string,
  kind: 'photo' | 'voice',
): boolean {
  const match = /^([^;,]+)(?:;\s*codecs=[\w., "-]+)?$/.exec(mimeType)
  if (!match || bytes.length === 0 || bytes.length > (kind === 'photo' ? 4 : 8) * 1024 * 1024)
    return false
  const mime = match[1]
  const allowed =
    kind === 'photo'
      ? ['image/jpeg', 'image/png', 'image/webp']
      : ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav']
  if (!allowed.includes(mime)) return false
  try {
    switch (mime) {
      case 'image/jpeg':
        return validJpeg(bytes)
      case 'image/png':
        return validPng(bytes)
      case 'image/webp': {
        const chunks = riffChunks(bytes, 'WEBP')
        return Boolean(
          chunks &&
          ((chunks.get('VP8 ')?.length ?? 0) >= 10 ||
            (chunks.get('VP8L')?.length ?? 0) >= 5 ||
            (chunks.get('ANMF')?.length ?? 0) >= 16),
        )
      }
      case 'audio/webm':
        return validWebm(bytes)
      case 'audio/mp4':
        return validMp4(bytes)
      case 'audio/ogg':
        return validOgg(bytes)
      default: {
        const chunks = riffChunks(bytes, 'WAVE'),
          format = chunks?.get('fmt ')
        return Boolean(
          format &&
          format.length >= 16 &&
          format[2] + format[3] * 256 > 0 &&
          uint32(format, 4, true) > 0 &&
          (chunks?.get('data')?.length ?? 0) > 0,
        )
      }
    }
  } catch {
    return false
  }
}

/** Decode imported photos before opening a write transaction. Audio container checks are codec-independent. */
export async function validateBackupMedia(backup: Backup): Promise<void> {
  if (typeof Image === 'undefined') return // Non-browser callers still receive all structural checks.
  const photos = new Set(
    backup.projects.flatMap((project) =>
      project.checkpoints.flatMap((checkpoint) => (checkpoint.photo ? [checkpoint.photo] : [])),
    ),
  )
  for (const photo of photos) {
    await new Promise<void>((resolve, reject) => {
      const image = new Image()
      const timer = setTimeout(
        () =>
          finish(
            new UserFacingError(
              'A backup photo could not be decoded. Your current collection is unchanged.',
            ),
          ),
        10000,
      )
      function finish(error?: Error) {
        clearTimeout(timer)
        image.onload = image.onerror = null
        image.src = ''
        if (error) reject(error)
        else resolve()
      }
      image.onload = () =>
        finish(
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? undefined
            : new UserFacingError('A backup photo has invalid dimensions.'),
        )
      image.onerror = () =>
        finish(
          new UserFacingError(
            'A backup photo is damaged or unsupported. Your current collection is unchanged.',
          ),
        )
      image.src = photo
    })
  }
}
