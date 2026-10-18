import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({
  check: vi.fn(),
  request: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  photo: vi.fn(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/app', () => ({
  App: {
    getState: async () => ({ isActive: true }),
    addListener: async (name: string, listener: (...args: unknown[]) => void) => {
      fixture.listeners.set(name, listener)
      return { remove: async () => fixture.listeners.delete(name) }
    },
  },
}))
vi.mock('@capgo/capacitor-audio-recorder', () => ({
  CapacitorAudioRecorder: {
    checkPermissions: fixture.check,
    requestPermissions: fixture.request,
    startRecording: fixture.start,
    stopRecording: fixture.stop,
    cancelRecording: fixture.cancel,
    addListener: async (name: string, listener: (...args: unknown[]) => void) => {
      fixture.listeners.set(name, listener)
      return { remove: async () => fixture.listeners.delete(name) }
    },
  },
}))
vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: fixture.photo },
  CameraResultType: { Base64: 'base64' },
  CameraSource: { Prompt: 'prompt' },
}))
import { NativeAudio } from './audio'
import { NativeCamera, type CameraContinuation } from './camera'
describe('supplemental native capture dispatch guards (not device evidence)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    fixture.listeners.clear()
  })
  it('never starts the recorder when microphone permission is denied', async () => {
    fixture.check.mockResolvedValue({ recordAudio: 'denied' })
    const audio = new NativeAudio({ isCurrent: () => true, onInterrupted: () => undefined })
    expect(await audio.startRecording()).toMatchObject({
      status: 'rejected',
      error: { code: 'PERMISSION_DENIED' },
    })
    expect(fixture.start).not.toHaveBeenCalled()
    await audio.dispose()
    expect(fixture.listeners.size).toBe(0)
  })
  it('cancellation during permission inspection cannot show a late permission request or start recording', async () => {
    let release!: (value: unknown) => void
    fixture.check.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const audio = new NativeAudio({ isCurrent: () => true, onInterrupted: () => undefined })
    const started = audio.startRecording()
    await vi.waitFor(() => expect(fixture.check).toHaveBeenCalled())
    const cancelled = audio.cancelRecording()
    release({ recordAudio: 'prompt' })
    expect(await started).toMatchObject({ status: 'cancelled', mayHaveCommitted: false })
    await cancelled
    expect(fixture.request).not.toHaveBeenCalled()
    expect(fixture.start).not.toHaveBeenCalled()
    await audio.dispose()
  })
  it('late camera results after a source switch cannot attach to another collection', async () => {
    let current = true,
      release!: (value: unknown) => void
    fixture.photo.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const pending = new NativeCamera(() => current).photo()
    current = false
    release({ format: 'jpeg', base64String: 'not-read' })
    expect(await pending).toEqual({ status: 'cancelled', mayHaveCommitted: false })
  })
  it('late camera delivery preserves its original durable continuation for explicit recovery', async () => {
    let current = true
    const recovery = {
      begin: vi.fn(async () => 'capture'),
      restore: vi.fn(async () => 'capture'),
      finish: vi.fn(),
    }
    fixture.photo.mockImplementation(async () => {
      current = false
      return { format: 'jpeg', base64String: 'fixture' }
    })
    const continuation = {
      recovery,
      source: { scope: {}, draftKey: 'draft' },
    } as unknown as CameraContinuation
    expect(await new NativeCamera(() => current, continuation).photo()).toMatchObject({
      status: 'cancelled',
    })
    expect(recovery.restore).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'Camera', success: true }),
    )
    expect(recovery.finish).not.toHaveBeenCalled()
  })
  it('separate form instances cannot start or cancel each other’s recorder', async () => {
    fixture.check.mockResolvedValue({ recordAudio: 'granted' })
    const first = new NativeAudio({ isCurrent: () => true, onInterrupted: () => undefined })
    const second = new NativeAudio({ isCurrent: () => true, onInterrupted: () => undefined })
    expect(await first.startRecording()).toMatchObject({ status: 'ok' })
    expect(await second.startRecording()).toMatchObject({ status: 'unavailable' })
    await second.dispose()
    expect(fixture.start).toHaveBeenCalledTimes(1)
    expect(fixture.cancel).not.toHaveBeenCalled()
    await first.dispose()
    expect(fixture.cancel).toHaveBeenCalledTimes(1)
  })
  it('camera and gallery cancellation is a quiet cancelled result', async () => {
    fixture.photo.mockRejectedValue(new Error('User cancelled photos app'))
    expect(await new NativeCamera(() => true).photo()).toEqual({
      status: 'cancelled',
      mayHaveCommitted: false,
    })
  })
})
