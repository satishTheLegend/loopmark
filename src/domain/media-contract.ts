import type { MediaKind } from './contracts'

export function supportedMediaType(mimeType: string, kind?: MediaKind): boolean {
  const match =
    /^(image\/(?:jpeg|png|webp)|audio\/(?:webm|mp4|ogg|wav|x-wav))(?:;\s*codecs=[\w., "-]+)?$/.exec(
      mimeType,
    )
  return (
    mimeType.length <= 100 &&
    !!match &&
    (!kind || match[1].startsWith(kind === 'photo' ? 'image/' : 'audio/'))
  )
}
