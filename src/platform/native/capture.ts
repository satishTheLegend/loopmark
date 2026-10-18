import type { CapturePort } from '../contracts'
import { NativeCamera, type CameraContinuation } from './camera'
import { NativeAudio, type NativeAudioOptions } from './audio'

export function createNativeCapture(
  options: NativeAudioOptions & { cameraContinuation?: CameraContinuation },
): CapturePort & { dispose(): Promise<void> } {
  let disposed = false
  const isCurrent = () => !disposed && options.isCurrent()
  const camera = new NativeCamera(isCurrent, options.cameraContinuation)
  const audio = new NativeAudio({ ...options, isCurrent })
  return {
    photo: () => camera.photo(),
    startRecording: () => audio.startRecording(),
    stopRecording: () => audio.stopRecording(),
    cancelRecording: () => audio.cancelRecording(),
    async dispose() {
      disposed = true
      await audio.dispose()
    },
  }
}
