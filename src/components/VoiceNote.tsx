import { UserFacingError } from '../domain/errors'
import { useEffect, useRef, useState } from 'react'
import { IconMicrophone, IconPlayerStop, IconTrash } from '@tabler/icons-react'
import { readFile } from '../media'
import { errorText } from './ui'
export function VoiceNote({
  value,
  onChange,
  onBusy,
  onFinishReady,
}: {
  value?: string
  onChange: (v?: string) => void
  onBusy: (v: boolean) => void
  onFinishReady: (finish?: () => Promise<boolean>) => void
}) {
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined),
    alive = useRef(true)
  const completed = useRef<Promise<boolean>>(Promise.resolve(true))
  const converting = useRef(false)
  useEffect(() => {
    onFinishReady(async () => {
      if (recorder.current?.state === 'recording') {
        converting.current = true
        setProcessing(true)
        recorder.current.stop()
        clearInterval(timer.current)
        stream.current?.getTracks().forEach((track) => track.stop())
      }
      return converting.current ? completed.current : true
    })
    return () => onFinishReady(undefined)
  }, [onFinishReady])
  const [recording, setRecording] = useState(false),
    [pending, setPending] = useState(false),
    [processing, setProcessing] = useState(false),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState('')
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearInterval(timer.current)
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  const stop = () => {
    if (recorder.current?.state === 'recording') {
      converting.current = true
      setProcessing(true)
      recorder.current.stop()
    }
    clearInterval(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    setRecording(false)
  }
  async function start() {
    if (converting.current || pending) return
    setError('')
    setPending(true)
    onBusy(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new UserFacingError(
          'Voice recording is unavailable here. Add the details in your written note instead. Use HTTPS or localhost for microphone access.',
        )
      const input = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!alive.current) {
        input.getTracks().forEach((t) => t.stop())
        return
      }
      stream.current = input
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      )
      const rec = new MediaRecorder(input, mime ? { mimeType: mime } : undefined),
        chunks: BlobPart[] = []
      recorder.current = rec
      let finishRecording: (saved: boolean) => void = () => {}
      completed.current = new Promise<boolean>((resolve) => {
        finishRecording = resolve
      })
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      rec.onstop = async () => {
        clearInterval(timer.current)
        input.getTracks().forEach((t) => t.stop())
        if (!alive.current) {
          finishRecording(false)
          return
        }
        converting.current = true
        setProcessing(true)
        setRecording(false)
        let saved = false
        try {
          const blob = new Blob(chunks, { type: rec.mimeType })
          if (blob.size > 8 * 1024 * 1024)
            throw new UserFacingError('This voice note is too large. Try a shorter recording.')
          if (!blob.size)
            throw new UserFacingError('The microphone did not capture any audio. Please try again.')
          const data = await readFile(blob)
          if (alive.current) {
            onChange(data)
            saved = true
          }
        } catch (err) {
          if (alive.current) setError(errorText(err))
        } finally {
          converting.current = false
          if (alive.current) {
            onBusy(false)
            setProcessing(false)
          }
          finishRecording(saved)
        }
      }
      rec.onerror = () => {
        stop()
        setError('Recording stopped unexpectedly. Try again or use a written note.')
        finishRecording(false)
      }
      rec.start()
      setRecording(true)
      setSeconds(0)
      let elapsed = 0
      timer.current = setInterval(() => {
        elapsed++
        setSeconds(elapsed)
        if (elapsed >= 120) stop()
      }, 1000)
    } catch (err) {
      stream.current?.getTracks().forEach((t) => t.stop())
      if (alive.current) {
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Microphone permission was declined. You can allow it in browser settings, or use a written note.'
            : errorText(err),
        )
        onBusy(false)
      }
    } finally {
      if (alive.current) setPending(false)
    }
  }
  return (
    <div className="voice-note">
      <div className="field-caption">
        Voice note <span>optional · up to 2 minutes</span>
      </div>
      {value && !recording ? (
        <div className="audio-row">
          <audio controls src={value} />
          <button
            type="button"
            className="icon-button"
            aria-label="Remove voice note"
            onClick={() => onChange(undefined)}
          >
            <IconTrash size={19} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`button secondary ${recording ? 'recording' : ''}`}
          disabled={pending || processing}
          onClick={recording ? stop : start}
        >
          {recording ? <IconPlayerStop size={18} /> : <IconMicrophone size={18} />}{' '}
          {processing
            ? 'Preparing voice note…'
            : pending
              ? 'Waiting for microphone…'
              : recording
                ? `Stop recording · ${seconds}s`
                : 'Record a quick note'}
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  )
}
