import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import type { BoundaryResult } from '../../domain/contracts'
import type { MediaInput } from '../contracts'
import { DomainError } from '../../domain/errors'
import { preparePhoto } from '../../media'
import { dataUrlToBlob } from '../../services/media-codec'
import { LIMITS } from '../../domain/policy'
import { cancelled, nativeFailure, requireNative } from './boundary'
import type { NativeCaptureRecovery, NativeCaptureSource } from './capture-recovery'

let cameraBusy = false
export interface CameraContinuation {
  recovery: NativeCaptureRecovery
  source: NativeCaptureSource
}

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
  constructor(
    private isCurrent: () => boolean,
    private continuation?: CameraContinuation,
  ) {}
  async photo(): Promise<BoundaryResult<MediaInput>> {
    if (cameraBusy) return nativeFailure(new DomainError('CAPABILITY_UNAVAILABLE'))
    cameraBusy = true
    let continuationId: string | undefined
    try {
      requireNative()
      if (!this.isCurrent()) return cancelled()
      if (this.continuation)
        continuationId = await this.continuation.recovery.begin(this.continuation.source)
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
      if (!this.isCurrent()) {
        if (continuationId && this.continuation) {
          await this.continuation.recovery.restore({
            pluginId: 'Camera',
            methodName: 'getPhoto',
            success: true,
            data: photo,
          })
          continuationId = undefined
        }
        return cancelled()
      }
      const value = await normalizeNativePhoto(photo)
      if (!this.isCurrent()) {
        if (continuationId && this.continuation) {
          await this.continuation.recovery.restore({
            pluginId: 'Camera',
            methodName: 'getPhoto',
            success: true,
            data: photo,
          })
          continuationId = undefined
        }
        return cancelled()
      }
      return { status: 'ok', value }
    } catch (error) {
      return nativeFailure(error)
    } finally {
      if (continuationId)
        await this.continuation?.recovery.finish(continuationId).catch(() => undefined)
      cameraBusy = false
    }
  }
}
