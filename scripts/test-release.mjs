#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { evaluateRelease } from './release/evidence.mjs'

// Read-only local evidence check. It never deploys, submits, purchases, contacts participants or grants approval.
try {
  const { values } = parseArgs({
    options: {
      environment: { type: 'string' },
      platform: { type: 'string' },
      manifest: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  const { environment, platform } = values
  const path = values.manifest ?? `.gstack/release/${environment}-${platform}.json`
  if ((await stat(path)).size > 256 * 1024) throw new Error()
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  const clean = !execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  const report = await evaluateRelease({
    root: resolve('.'),
    manifest,
    environment,
    platform,
    revision,
    clean,
  })
  if (values.json) console.log(JSON.stringify(report))
  else {
    console.log(`Release evidence: ${report.status}. No release action was performed.`)
    for (const check of report.checks)
      console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`)
    console.log(
      'Matching files and recorded statuses do not replace independent review or explicit release authorization.',
    )
  }
  process.exitCode = report.status === 'evidence-complete' ? 0 : 2
} catch {
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      status: 'blocked',
      performedRelease: false,
      message:
        'Supply --environment staging|production --platform web|ios|android and an existing bounded JSON evidence manifest. No readiness claim or release action was made.',
    }),
  )
  process.exitCode = 2
}
