import { registerPlugin } from '@capacitor/core'

export interface DurableFilesBridge {
  put(input: { key: string; base64: string; sha256: string }): Promise<void>
  read(input: { key: string }): Promise<{ base64: string }>
  remove(input: { key: string }): Promise<void>
  list(): Promise<{ files: { key: string; modifiedAt: number }[] }>
  sweepTemporary(): Promise<void>
}
// No web implementation: a browser must never silently become native durable storage.
export const durableFiles = registerPlugin<DurableFilesBridge>('LoopmarkDurableFiles')
