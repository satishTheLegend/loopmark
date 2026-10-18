import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import type { BoundaryResult } from '../../domain/contracts'
import type { MediaInput } from '../contracts'
import { DomainError } from '../../domain/errors'
import { preparePhoto } from '../../media'
import { dataUrlToBlob } from '../../services/media-codec'
import { LIMITS } from '../../domain/policy'
import { cancelled, nativeFailure, requireNative } from './boundary'

/** Re-encode resized pixels so the stored photo has predictable MIME/size and no source EXIF. */
export async function normalizeNativePhoto(value: unknown): Promise<MediaInput> {
  if (!value || typeof value !== 'object') throw new DomainError('MEDIA_INVALID')
  const photo = value as { format?: unknown; base64String?: unknown }
  if (
    !['jpeg', 'png', 'webp'].includes(String(photo.format)) ||
    typeof photo.base64String !== 'string' ||
    photo.base64String.length > 20 * 1024 * 1024
  )
    throw new DomainError('MEDIA_INVALID')
  const source = dataUrlToBlob(`data:image/${photo.format};base64,${photo.base64String}`)
  const converted = dataUrlToBlob(
    await preparePhoto(new File([source], 'capture', { type: source.type })),
  )
  if (!converted.size || converted.size > LIMITS.photoBytes) throw new DomainError('MEDIA_INVALID')
  return { kind: 'photo', bytes: converted }
}
export class NativeCamera {
  private busy = false
  constructor(private isCurrent: () => boolean) {}
  async photo(): Promise<BoundaryResult<MediaInput>> {
    if (this.busy) return nativeFailure(new DomainError('CAPABILITY_UNAVAILABLE'))
    this.busy = true
    try {
      requireNative()
      if (!this.isCurrent()) return cancelled()
      const photo = await Camera.getPhoto({
        quality: 85,
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
        width: 1600,
        height: 1600,
        correctOrientation: true,
        saveToGallery: false,
        promptLabelHeader: 'Checkpoint photo',
        promptLabelCancel: 'Cancel',
        promptLabelPhoto: 'Choose photo',
        promptLabelPicture: 'Take photo',
      })
      if (!this.isCurrent()) return cancelled()
      const value = await normalizeNativePhoto(photo)
      return this.isCurrent() ? { status: 'ok', value } : cancelled()
    } catch (error) {
      return nativeFailure(error)
    } finally {
      this.busy = false
    }
  }
}
