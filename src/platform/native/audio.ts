import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { Filesystem } from '@capacitor/filesystem'
import {
  CapacitorAudioRecorder as Recorder,
  type StopRecordingResult,
} from '@capgo/capacitor-audio-recorder'
import type { BoundaryResult } from '../../domain/contracts'
import type { MediaInput } from '../contracts'
import { DomainError } from '../../domain/errors'
import { LIMITS } from '../../domain/policy'
import { validMedia } from '../../media-validation'
import { dataUrlToBlob } from '../../services/media-codec'
import { cancelled, nativeFailure, requireNative } from './boundary'

// The native plugin has one recorder per process, including across overlapping form lifetimes.
let recorderQueue: Promise<unknown> = Promise.resolve()
let recorderOwner: NativeAudio | undefined

export interface NativeAudioOptions {
  isCurrent: () => boolean
  /** Preserve the result in the source-bound draft; never auto-submit a checkpoint. */
  onInterrupted: (result: BoundaryResult<MediaInput>) => void | Promise<void>
}
/** Foreground-only recorder. Every native command is serialized; late callbacks are fenced. */
export class NativeAudio {
  private handles: PluginListenerHandle[] = []
  private recording = false
  private finishing = false
  private disposed = false
  private epoch = 0
  private timer?: ReturnType<typeof setTimeout>
  constructor(private options: NativeAudioOptions) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = recorderQueue.then(action)
    recorderQueue = result.catch(() => undefined)
    return result
  }
  private current(epoch: number) {
    return !this.disposed && this.epoch === epoch && this.options.isCurrent()
  }
  private async listen() {
    if (this.handles.length) return
    try {
      this.handles.push(
        await App.addListener('appStateChange', (event) => {
          if (!event.isActive) this.interrupt()
        }),
      )
      this.handles.push(await Recorder.addListener('recordingPaused', () => this.interrupt()))
      this.handles.push(await Recorder.addListener('recordingError', () => this.interrupt()))
      this.handles.push(
        await Recorder.addListener('recordingStopped', (result) => {
          if (this.recording && !this.finishing) this.interrupt(result)
        }),
      )
    } catch (error) {
      await Promise.allSettled(this.handles.map((handle) => handle.remove()))
      this.handles = []
      throw error
    }
  }
  private interrupt(stopped?: StopRecordingResult) {
    if (!this.recording || this.finishing) return
    this.finishing = true
    const epoch = this.epoch
    void this.serial(async () => {
      const result = await this.finish(epoch, stopped)
      if (this.current(epoch)) await this.options.onInterrupted(result)
    }).catch(() => undefined)
  }
  async startRecording(): Promise<BoundaryResult<void>> {
    const epoch = this.epoch
    return this.serial(async () => {
      try {
        requireNative()
        if (!this.current(epoch)) return cancelled()
        if (recorderOwner) throw new DomainError('CAPABILITY_UNAVAILABLE')
        recorderOwner = this
        await this.listen()
        let permission = await Recorder.checkPermissions()
        if (!this.current(epoch)) return cancelled()
        if (
          permission.recordAudio === 'prompt' ||
          permission.recordAudio === 'prompt-with-rationale'
        )
          permission = await Recorder.requestPermissions()
        if (permission.recordAudio !== 'granted') throw new DomainError('PERMISSION_DENIED')
        if (!this.current(epoch)) return cancelled()
        if (!(await App.getState()).isActive) return cancelled()
        if (!this.current(epoch)) return cancelled()
        await Recorder.startRecording({
          bitRate: 64000,
          sampleRate: 44100,
          resetToPlaybackOnStop: true,
        })
        if (!this.current(epoch)) {
          await Recorder.cancelRecording()
          return cancelled()
        }
        this.recording = true
        this.finishing = false
        this.timer = setTimeout(() => this.interrupt(), 120_000)
        return { status: 'ok', value: undefined }
      } catch (error) {
        return nativeFailure(error)
      } finally {
        if (!this.recording && recorderOwner === this) recorderOwner = undefined
      }
    })
  }
  private async finish(
    epoch: number,
    stopped?: StopRecordingResult,
  ): Promise<BoundaryResult<MediaInput>> {
    clearTimeout(this.timer)
    this.finishing = true
    let uri: string | undefined
    try {
      const result = stopped ?? (await Recorder.stopRecording())
      uri = result.uri
      // Only the recorder's own private temporary directory may be read or removed.
      if (
        !uri ||
        !/^file:\/\/\/.*\/(?:CapacitorAudioRecorder|capacitor-audio-recorder)\/[^/]+\.m4a$/.test(
          uri,
        )
      )
        throw new DomainError('MEDIA_INVALID')
      const stat = await Filesystem.stat({ path: uri })
      if (!stat.size || stat.size > LIMITS.voiceBytes) throw new DomainError('MEDIA_INVALID')
      const file = await Filesystem.readFile({ path: uri })
      if (typeof file.data !== 'string') throw new DomainError('MEDIA_INVALID')
      const dataUrl = `data:audio/mp4;base64,${file.data}`
      if (!validMedia(dataUrl, 'voice')) throw new DomainError('MEDIA_INVALID')
      const bytes = dataUrlToBlob(dataUrl)
      if (bytes.size !== stat.size) throw new DomainError('MEDIA_INVALID')
      return this.current(epoch) ? { status: 'ok', value: { kind: 'voice', bytes } } : cancelled()
    } catch (error) {
      return nativeFailure(error)
    } finally {
      this.recording = false
      this.finishing = false
      if (recorderOwner === this) recorderOwner = undefined
      if (
        uri &&
        /^file:\/\/\/.*\/(?:CapacitorAudioRecorder|capacitor-audio-recorder)\/[^/]+\.m4a$/.test(uri)
      )
        await Filesystem.deleteFile({ path: uri }).catch(() => undefined)
    }
  }
  async stopRecording(): Promise<BoundaryResult<MediaInput>> {
    const epoch = this.epoch
    return this.serial(async () => {
      if (!this.recording) return cancelled()
      return this.finish(epoch)
    })
  }
  async cancelRecording(): Promise<void> {
    this.epoch++
    clearTimeout(this.timer)
    await this.serial(async () => {
      try {
        if (this.recording && recorderOwner === this) await Recorder.cancelRecording()
      } finally {
        this.recording = false
        this.finishing = false
        if (recorderOwner === this) recorderOwner = undefined
      }
    })
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await this.cancelRecording()
    await Promise.allSettled(this.handles.map((handle) => handle.remove()))
    this.handles = []
  }
}
