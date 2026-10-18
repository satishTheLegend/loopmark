#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { loadOperatorConfig } from './lib/config.mjs'

// This runner never starts, resets, migrates or stops a backend. Use an already authorized local stack.
try {
  if (!process.env.LOOPMARK_SYNC_PUBLIC_ENV)
    throw new Error(
      'Set LOOPMARK_SYNC_PUBLIC_ENV to the public configuration for an authorized local stack.',
    )
  const { config, environment } = await loadOperatorConfig()
  const source = parseEnv(await readFile(process.env.LOOPMARK_SYNC_PUBLIC_ENV, 'utf8'))
  const publicEnvironment = Object.fromEntries(
    [
      'VITE_LOOPMARK_APP_ORIGIN',
      'VITE_LOOPMARK_SUPABASE_URL',
      'VITE_LOOPMARK_SUPABASE_ANON_KEY',
    ].map((key) => [key, source[key]]),
  )
  const key = publicEnvironment.VITE_LOOPMARK_SUPABASE_ANON_KEY
  let publicKey = typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)
  if (!publicKey && typeof key === 'string' && key.length < 8192) {
    try {
      publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'
    } catch {
      publicKey = false
    }
  }
  if (
    publicEnvironment.VITE_LOOPMARK_APP_ORIGIN !== config.appOrigin ||
    publicEnvironment.VITE_LOOPMARK_SUPABASE_URL !== config.backendUrl ||
    !publicKey
  )
    throw new Error(
      'Public configuration must exactly match this selected loopback profile and port overrides.',
    )
  for (const url of [
    config.backendUrl + '/auth/v1/health',
    `http://127.0.0.1:${config.ports.mail}/api/v1/messages`,
  ]) {
    const result = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      headers: { apikey: publicEnvironment.VITE_LOOPMARK_SUPABASE_ANON_KEY },
    })
    await result.body?.cancel()
    if (!result.ok) throw new Error('The selected local Auth/Mailpit service is not ready.')
  }
  const args = process.argv.slice(2)
  const loadCapture = args.includes('--load-capture')
  const child = spawn(
    process.execPath,
    [
      resolve('node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      loadCapture ? 'playwright.load-capture.config.ts' : 'playwright.sync.config.ts',
      ...args.filter((argument) => argument !== '--load-capture'),
    ],
    {
      stdio: 'inherit',
      env: { ...environment, ...publicEnvironment, LOOPMARK_TEST_PORT: String(config.ports.app) },
    },
  )
  child.on('error', () => {
    console.error('Unable to start the installed Playwright runner.')
    process.exitCode = 2
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 2
  })
} catch {
  console.error(
    'Local sync smoke is unavailable: explicitly select the authorized local profile/ports and LOOPMARK_SYNC_PUBLIC_ENV, and start its Auth/Mailpit services first. No tests were skipped and no backend was changed.',
  )
  process.exitCode = 2
}
