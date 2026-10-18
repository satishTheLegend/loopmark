import { spawn } from 'node:child_process'
import { mkdir, access } from 'node:fs/promises'
import { resolve } from 'node:path'
export const root = resolve(import.meta.dirname, '../..')
export async function run(command, args, options = {}) {
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, CI: '1', ...options.env },
      ...options,
    })
    child.once('error', reject)
    child.once('exit', resolveCode)
  })
  if (code !== 0) throw new Error(`${command} exited ${code}`)
}
export async function androidEnvironment() {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    resolve(process.env.HOME, 'Library/Android/sdk')
  await access(resolve(sdk, 'platforms/android-36/android.jar'))
  const java = process.env.LOOPMARK_JAVA_HOME || process.env.JAVA_HOME
  if (!java)
    throw new Error(
      'Set LOOPMARK_JAVA_HOME to a Java 21 installation. No global settings or licenses are changed.',
    )
  return { ...process.env, CI: '1', JAVA_HOME: java, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk }
}
export async function evidenceDirectory() {
  const path = resolve(root, 'docs/evidence/expansion/native')
  await mkdir(path, { recursive: true })
  return path
}
