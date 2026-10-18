import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { DomainError } from '../../domain/errors'

export interface NativeNetworkState {
  connected: boolean
}
export async function nativeNetworkState(): Promise<NativeNetworkState> {
  if (!Capacitor.isNativePlatform()) throw new DomainError('CAPABILITY_UNAVAILABLE')
  const { connected } = await Network.getStatus()
  return { connected }
}
export async function subscribeNativeNetwork(
  listener: (state: NativeNetworkState) => void,
): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform()) throw new DomainError('CAPABILITY_UNAVAILABLE')
  let active = true
  const send = (state: NativeNetworkState) => {
    if (active) {
      try {
        listener({ connected: state.connected })
      } catch {
        /* Isolate observers. */
      }
    }
  }
  const handle = await Network.addListener('networkStatusChange', send)
  try {
    send(await nativeNetworkState())
  } catch (error) {
    await handle.remove()
    throw error
  }
  return async () => {
    active = false
    await handle.remove()
  }
}
