import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { DomainError } from '../../domain/errors'
import { nativeIncomingUrl } from './links'
import { subscribeNativeNetwork } from './network'

export type NativeLifecycleEvent =
  | { type: 'active'; active: boolean }
  | { type: 'back'; canGoBack: boolean }
  | { type: 'url'; url: string }
  | { type: 'network'; connected: boolean }

/** Emits facts only. Router, login continuation, draft preservation and sync stay in shared services. */
export async function subscribeNativeLifecycle(
  listener: (event: NativeLifecycleEvent) => void,
): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform()) throw new DomainError('CAPABILITY_UNAVAILABLE')
  let active = true,
    removeNetwork: (() => Promise<void>) | undefined
  const handles: PluginListenerHandle[] = []
  const send = (event: NativeLifecycleEvent) => {
    if (active) {
      try {
        listener(event)
      } catch {
        /* Isolate observers. */
      }
    }
  }
  const sendUrl = (value: unknown) => {
    const url = nativeIncomingUrl(value)
    if (url) send({ type: 'url', url })
  }
  const dispose = async () => {
    active = false
    await Promise.allSettled([
      ...handles.map((handle) => handle.remove()),
      ...(removeNetwork ? [removeNetwork()] : []),
    ])
  }
  try {
    handles.push(
      await App.addListener('appStateChange', (state) =>
        send({ type: 'active', active: state.isActive }),
      ),
    )
    handles.push(
      await App.addListener('backButton', (event) =>
        send({ type: 'back', canGoBack: event.canGoBack }),
      ),
    )
    handles.push(await App.addListener('appUrlOpen', (event) => sendUrl(event.url)))
    removeNetwork = await subscribeNativeNetwork((state) =>
      send({ type: 'network', connected: state.connected }),
    )
    send({ type: 'active', active: (await App.getState()).isActive })
    sendUrl((await App.getLaunchUrl())?.url)
    return dispose
  } catch (error) {
    await dispose()
    throw error
  }
}

/** The shared router calls this only after handling its own form/modal/history stack. */
export async function minimizeNativeApp(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') throw new DomainError('CAPABILITY_UNAVAILABLE')
  await App.minimizeApp()
}
