import { useEffect, useRef, useState } from 'react'
import { IconMicrophone, IconPlayerStop, IconTrash } from '@tabler/icons-react'
import type { AppRuntime } from '../runtime'
import type { BoundaryResult } from '../domain/contracts'
import type { MediaInput } from '../platform/contracts'
import { readFile } from '../media'
import { errorText } from './ui'

export function NativeVoiceNote({
  runtime,
  value,
  onChange,
  onBusy,
  onFinishReady,
}: {
  runtime: AppRuntime
  value?: string
  onChange: (value?: string) => Promise<void>
  onBusy: (busy: boolean) => void
  onFinishReady: (finish?: () => Promise<boolean>) => void
}) {
  const [recording, setRecording] = useState(false),
    [pending, setPending] = useState(false),
    [seconds, setSeconds] = useState(0),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const current = useRef({ onChange, onBusy })
  current.current = { onChange, onBusy }
  const alive = useRef(false),
    recordingRef = useRef(false),
    timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined),
    capture = useRef<ReturnType<AppRuntime['createVoiceCapture']>>(undefined),
    finishing = useRef<Promise<boolean> | undefined>(undefined),
    starting = useRef(false)
  async function accept(result: BoundaryResult<MediaInput>, interrupted = false): Promise<boolean> {
    clearInterval(timer.current)
    recordingRef.current = false
    if (!alive.current) return false
    setRecording(false)
    setPending(true)
    try {
      if (result.status === 'ok') {
        const data = await readFile(result.value.bytes)
        if (!alive.current) return false
        await current.current.onChange(data)
        if (alive.current && interrupted)
          setMessage(
            'Recording stopped. The captured audio is kept in this draft; review it before saving your checkpoint.',
          )
        return true
      }
      if ('error' in result) setError(`${result.error.problem} ${result.error.nextAction}`)
      return false
    } catch (failure) {
      if (alive.current) setError(errorText(failure))
      return false
    } finally {
      if (alive.current) {
        setPending(false)
        current.current.onBusy(false)
      }
    }
  }
  const acceptRef = useRef(accept)
  acceptRef.current = accept
  useEffect(() => {
    alive.current = true
    const owned = runtime.createVoiceCapture({
      isCurrent: () => alive.current,
      onInterrupted: async (result) => {
        finishing.current = acceptRef.current(result, true)
        await finishing.current
      },
    })
    capture.current = owned
    return () => {
      alive.current = false
      clearInterval(timer.current)
      void owned?.dispose()
      capture.current = undefined
    }
  }, [runtime])
  async function finish(): Promise<boolean> {
    if (starting.current) return false
    if (finishing.current) return finishing.current
    if (!recordingRef.current || !capture.current) return true
    setPending(true)
    finishing.current = capture.current.stopRecording().then((result) => acceptRef.current(result))
    return finishing.current
  }
  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => {
    onFinishReady(() => finishRef.current())
    return () => onFinishReady(undefined)
  }, [onFinishReady])
  async function start() {
    if (!capture.current || starting.current || recordingRef.current) return
    starting.current = true
    finishing.current = undefined
    setPending(true)
    setError('')
    setMessage('')
    current.current.onBusy(true)
    try {
      const result = await capture.current.startRecording()
      if (!alive.current) return
      if (result.status !== 'ok') {
        if ('error' in result) setError(`${result.error.problem} ${result.error.nextAction}`)
        current.current.onBusy(false)
        return
      }
      recordingRef.current = true
      setRecording(true)
      setSeconds(0)
      const started = Date.now()
      timer.current = setInterval(
        () => setSeconds(Math.min(120, Math.floor((Date.now() - started) / 1000))),
        1000,
      )
    } catch (failure) {
      if (alive.current) {
        setError(errorText(failure))
        current.current.onBusy(false)
      }
    } finally {
      starting.current = false
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
            disabled={pending}
            onClick={() => {
              void onChange(undefined).catch((failure) => setError(errorText(failure)))
            }}
          >
            <IconTrash size={19} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`button secondary ${recording ? 'recording' : ''}`}
          disabled={pending}
          onClick={() => {
            if (recording) void finish()
            else void start()
          }}
        >
          {recording ? <IconPlayerStop size={18} /> : <IconMicrophone size={18} />}
          {pending
            ? 'Preparing voice note…'
            : recording
              ? `Stop recording · ${seconds}s`
              : 'Record a quick note'}
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
