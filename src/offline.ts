import { useEffect, useState } from 'react'

type InstallEvent = Event & { prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }> }
export function useOfflineSupport(native = false) {
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('Checking offline availability…')
  const [update, setUpdate] = useState(false)
  const [checking, setChecking] = useState(false)
  const [install, setInstall] = useState<InstallEvent>()
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
  const [attempt, setAttempt] = useState(0)
  const [script, setScript] = useState('/sw.js')
  useEffect(() => {
    if (native) {
      setReady(true)
      setStatus(
        'The installed app opens offline. Download each project’s attachments before using them offline.',
      )
      return
    }
    let alive = true
    const cleanups: (() => void)[] = []
    let generation = 0
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
      setStatus(
        import.meta.env.PROD
          ? 'Offline installation is unavailable in this browser. Keep a backup.'
          : 'Offline installation is available in the production build.',
      )
      return
    }
    async function verify(reg: ServiceWorkerRegistration) {
      if (!alive) return
      setUpdate(!!reg.waiting)
      if (!reg.active) return
      const checkGeneration = ++generation
      const channel = new MessageChannel()
      const timer = setTimeout(() => {
        channel.port1.close()
        if (alive && checkGeneration === generation) {
          setReady(false)
          setStatus('Offline files could not be verified. Reconnect and try again.')
        }
      }, 5000)
      channel.port1.onmessage = (event) => {
        clearTimeout(timer)
        channel.port1.close()
        if (!alive || checkGeneration !== generation) return
        const complete = event.data?.ready === true
        setReady(complete)
        setStatus(
          complete
            ? 'Ready offline on this device.'
            : 'Offline files are incomplete. Reconnect, then check offline readiness to prepare them again.',
        )
      }
      reg.active.postMessage({ type: 'CHECK_OFFLINE_READY' }, [channel.port2])
      cleanups.push(() => {
        clearTimeout(timer)
        channel.port1.close()
      })
    }
    navigator.serviceWorker
      .register(script)
      .then((reg) => {
        if (!alive) return
        setRegistration(reg)
        const watch = () => {
          const worker = reg.installing
          if (!worker) {
            void verify(reg)
            return
          }
          const state = () => {
            if (!alive) return
            if (worker.state === 'activated' || worker.state === 'installed') void verify(reg)
            if (worker.state === 'redundant')
              setStatus('Offline installation failed. Reconnect and try again.')
          }
          worker.addEventListener('statechange', state)
          cleanups.push(() => worker.removeEventListener('statechange', state))
          state()
        }
        reg.addEventListener('updatefound', watch)
        const controlled = () => void verify(reg)
        navigator.serviceWorker.addEventListener('controllerchange', controlled)
        cleanups.push(
          () => reg.removeEventListener('updatefound', watch),
          () => navigator.serviceWorker.removeEventListener('controllerchange', controlled),
        )
        watch()
        void verify(reg)
      })
      .catch(() => {
        if (alive) {
          setReady(false)
          setStatus('Offline installation failed. Allow site storage, reconnect, and try again.')
        }
      })
    return () => {
      alive = false
      cleanups.forEach((fn) => fn())
    }
  }, [attempt, script, native])
  useEffect(() => {
    const prompt = (event: Event) => {
      event.preventDefault()
      setInstall(event as InstallEvent)
    }
    const installed = () => setInstall(undefined)
    window.addEventListener('beforeinstallprompt', prompt)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', prompt)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])
  async function check() {
    setChecking(true)
    try {
      if (registration) {
        if (!ready && registration.active) {
          // A changed script URL forces a new install to refill missing cache entries.
          // Waiting workers still activate naturally after old windows close.
          setScript(`/sw.js?repair=${crypto.randomUUID()}`)
        } else if (registration.active) {
          await registration.update()
          setUpdate(!!registration.waiting)
        }
      }
      setAttempt((n) => n + 1)
    } catch {
      setStatus('Could not check for updates. Reconnect and try again.')
    } finally {
      setChecking(false)
    }
  }
  async function installApp() {
    try {
      await install?.prompt()
    } catch {
      setStatus('Use your browser menu to install Loopmark, if available.')
    } finally {
      setInstall(undefined)
    }
  }
  return { ready, status, update, checking, canInstall: !!install, check, installApp }
}
