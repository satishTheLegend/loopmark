import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, open, rename, statfs } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  OpsError,
  uuid,
  hash,
  quote,
  sql,
  run,
  durableJson,
  readJson,
  currentLedger,
  rpc,
} from './common.mjs'
const day = 86400000
async function recoveryKey(ctx, create = false) {
  try {
    const key = await readFile(ctx.keyPath)
    if (key.length !== 32) throw new OpsError('SERVICE_UNAVAILABLE')
    return key
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) throw new OpsError('SERVICE_UNAVAILABLE')
  }
  await mkdir(resolve(ctx.keyPath, '..'), { recursive: true, mode: 0o700 })
  const file = await open(ctx.keyPath, 'wx', 0o600),
    key = randomBytes(32)
  try {
    await file.writeFile(key)
    await file.sync()
  } finally {
    await file.close()
  }
  const parent = await open(resolve(ctx.keyPath, '..'), 'r')
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
  return key
}
async function encrypt(path, bytes, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv),
    encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
  const file = await open(path + '.next', 'w', 0o600)
  try {
    await file.writeFile(Buffer.concat([iv, cipher.getAuthTag(), encrypted]))
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(path + '.next', path)
  const parent = await open(resolve(path, '..'), 'r')
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
}
async function decrypt(path, key) {
  const bytes = await readFile(path)
  if (bytes.length < 28) throw new OpsError('MEDIA_INVALID')
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    cipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()])
  } catch {
    throw new OpsError('MEDIA_INVALID')
  }
}
function pointDirectory(ctx, id) {
  if (!uuid.test(id)) throw new OpsError('VALIDATION')
  return resolve(ctx.recovery, id)
}
async function exportedSnapshot(ctx, signal) {
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      ctx.database,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  child.stderr.resume()
  child.stdin.on('error', () => {})
  const lines = createInterface({ input: child.stdout })
  const stop = () => child.kill('SIGTERM'),
    timer = setTimeout(stop, 240_000)
  signal?.addEventListener('abort', stop, { once: true })
  child.stdin.write(
    "select case when pg_try_advisory_lock(865119900) then 'LOCKED' else 'BUSY' end;begin isolation level repeatable read read only;select pg_export_snapshot();\n",
  )
  let locked = false
  for await (const line of lines) {
    if (line === 'BUSY') {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      stop()
      throw new OpsError('RATE_LIMITED')
    }
    if (line === 'LOCKED') locked = true
    if (locked && /^[A-F0-9]{8}-[A-F0-9]{8}-[0-9]+$/.test(line))
      return {
        id: line,
        close: async () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', stop)
          child.stdin.end('rollback;\n')
          if (child.exitCode === null) await new Promise((resolve) => child.once('close', resolve))
        },
      }
  }
  clearTimeout(timer)
  throw new OpsError('SERVICE_UNAVAILABLE')
}
async function boundedObject(ctx, key, maximum, signal) {
  const response = await fetch(
    ctx.url +
      '/storage/v1/object/authenticated/loopmark-private/' +
      key.split('/').map(encodeURIComponent).join('/'),
    {
      headers: { authorization: 'Bearer ' + ctx.key, apikey: ctx.key },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      redirect: 'error',
    },
  )
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new OpsError('MEDIA_UNAVAILABLE')
  }
  const reader = response.body.getReader(),
    chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maximum) throw new OpsError('MEDIA_INVALID')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks)
}
export async function backupSnapshot(ctx, { id = randomUUID(), signal, beforeCopy } = {}) {
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(240_000)])
    : AbortSignal.timeout(240_000)
  if (signal.aborted) throw new OpsError('CANCELLED')
  const directory = pointDirectory(ctx, id),
    snapshot = await exportedSnapshot(ctx, signal)
  try {
    const key = await recoveryKey(ctx, true)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const existing = await readJson(resolve(directory, 'index.json')).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw new OpsError('MEDIA_INVALID')
    })
    if (existing && !['complete', 'copying', 'incomplete'].includes(existing.state))
      throw new OpsError('MEDIA_INVALID')
    if (existing?.state === 'complete') {
      const verified = await verifyPoint(ctx, id)
      await synchronizePoint(ctx, verified.manifest, verified.index)
      return existing
    }
    if (existing) {
      // Retrying an incomplete snapshot replaces all of its old encrypted bytes before changing its inventory.
      for (const name of await readdir(directory)) {
        if (
          !/^(?:index\.json|manifest\.enc|database\.enc|[a-f0-9]{64}\.enc)(?:\.next)?$/.test(name)
        )
          throw new OpsError('MEDIA_INVALID')
        await rm(resolve(directory, name))
      }
      const folder = await open(directory, 'r')
      try {
        await folder.sync()
      } finally {
        await folder.close()
      }
      await sql(
        ctx,
        `begin;delete from loopmark_private.recovery_pins where point_id=${quote(id)};delete from loopmark_private.recovery_objects where point_id=${quote(id)}::uuid;delete from loopmark_private.recovery_accounts where point_id=${quote(id)}::uuid;commit;`,
      )
    }
    const createdAt = new Date().toISOString(),
      expiresAt = new Date(Date.now() + 7 * day).toISOString()
    const index = {
      schemaVersion: 1,
      id,
      state: 'copying',
      createdAt,
      expiresAt,
      objectCount: 0,
      bytes: 0,
    }
    try {
      await durableJson(resolve(directory, 'index.json'), index)
      await sql(
        ctx,
        `insert into loopmark_private.recovery_points(id,state,expires_at,snapshot_id) values(${quote(id)}::uuid,'copying',${quote(expiresAt)}::timestamptz,${quote(snapshot.id)}) on conflict(id) do update set state='copying',snapshot_id=excluded.snapshot_id,expires_at=excluded.expires_at`,
      )
      const raw = await sql(
        ctx,
        `begin isolation level repeatable read;set transaction snapshot ${quote(snapshot.id)};select coalesce(jsonb_agg(jsonb_build_object('key',o.object_key,'ownerId',o.owner_id,'sha256',o.sha256,'bytes',o.bytes) order by o.object_key),'[]') from loopmark_private.media_objects o where o.state='ready' and exists(select 1 from storage.objects s where s.bucket_id='loopmark-private' and s.name=o.object_key);commit;`,
      )
      const objects = JSON.parse(raw)
      const accounts = JSON.parse(
        await sql(
          ctx,
          `begin isolation level repeatable read;set transaction snapshot ${quote(snapshot.id)};select coalesce(jsonb_agg(id order by id),'[]') from loopmark_private.accounts where state<>'deleted';commit;`,
        ),
      )
      if (accounts.length > 100_000) throw new OpsError('TECHNICAL_CAPACITY_REACHED')
      for (let offset = 0; offset < accounts.length; offset += 100)
        await sql(
          ctx,
          `insert into loopmark_private.recovery_accounts(point_id,owner_id) values ${accounts
            .slice(offset, offset + 100)
            .map((owner) => `(${quote(id)}::uuid,${quote(owner)}::uuid)`)
            .join(',')} on conflict do nothing;`,
        )
      if (objects.length > 100_000) throw new OpsError('TECHNICAL_CAPACITY_REACHED')
      const filesystem = await statfs(directory),
        requiredBytes = objects.reduce((sum, object) => sum + object.bytes, 0) + 512 * 1024 * 1024
      if (filesystem.bavail * filesystem.bsize < requiredBytes + 2 * 1024 * 1024 * 1024)
        throw new OpsError('TECHNICAL_CAPACITY_REACHED')
      const missing = await sql(
        ctx,
        `begin isolation level repeatable read;set transaction snapshot ${quote(snapshot.id)};select count(*) from loopmark_private.media_objects o where o.state='ready' and not exists(select 1 from storage.objects s where s.bucket_id='loopmark-private' and s.name=o.object_key);commit;`,
      )
      if (missing !== '0') throw new OpsError('MEDIA_UNAVAILABLE')
      for (let offset = 0; offset < objects.length; offset += 100) {
        const batch = objects.slice(offset, offset + 100)
        await sql(
          ctx,
          `begin;insert into loopmark_private.recovery_pins(point_id,owner_id,object_key,expires_at) values ${batch.map((o) => `(${quote(id)},${quote(o.ownerId)}::uuid,${quote(o.key)},${quote(expiresAt)}::timestamptz)`).join(',')} on conflict(point_id,object_key) do update set expires_at=excluded.expires_at;insert into loopmark_private.recovery_objects(point_id,owner_id,object_key,sha256,bytes) values ${batch.map((o) => `(${quote(id)}::uuid,${quote(o.ownerId)}::uuid,${quote(o.key)},${quote(o.sha256)},${o.bytes})`).join(',')} on conflict do nothing;commit;`,
        )
      }
      for (const object of objects) object.file = hash(object.key) + '.enc'
      const manifest = {
        schemaVersion: 1,
        id,
        projectId: ctx.config.projectId,
        snapshotId: snapshot.id,
        createdAt,
        expiresAt,
        databaseHash: null,
        objects,
        accounts,
      }
      let manifestBytes = Buffer.from(JSON.stringify(manifest))
      await encrypt(resolve(directory, 'manifest.enc'), manifestBytes, key)
      Object.assign(index, { manifestHash: hash(manifestBytes), objectCount: objects.length })
      await durableJson(resolve(directory, 'index.json'), index)
      const dump = await run(
        'docker',
        [
          'exec',
          ctx.database,
          'pg_dump',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '--format=custom',
          '--snapshot=' + snapshot.id,
        ],
        { timeout: 180_000, maxBytes: 256 * 1024 * 1024, signal },
      )
      await encrypt(resolve(directory, 'database.enc'), dump, key)
      manifest.databaseHash = hash(dump)
      manifestBytes = Buffer.from(JSON.stringify(manifest))
      await encrypt(resolve(directory, 'manifest.enc'), manifestBytes, key)
      Object.assign(index, {
        databaseHash: manifest.databaseHash,
        manifestHash: hash(manifestBytes),
        bytes: dump.length + objects.reduce((sum, o) => sum + o.bytes, 0),
      })
      await durableJson(resolve(directory, 'index.json'), index)
      if (beforeCopy) await beforeCopy()
      for (let offset = 0; offset < objects.length; offset += 2)
        await Promise.all(
          objects.slice(offset, offset + 2).map(async (object) => {
            if (signal?.aborted) throw new OpsError('CANCELLED')
            const bytes = await boundedObject(ctx, object.key, object.bytes, signal)
            if (bytes.length !== object.bytes || hash(bytes) !== object.sha256)
              throw new OpsError('MEDIA_INVALID')
            object.file = hash(object.key) + '.enc'
            await encrypt(resolve(directory, object.file), bytes, key)
          }),
        )
      await verifyManifest(ctx, manifest, directory, key)
      Object.assign(index, {
        state: 'complete',
        completedAt: new Date().toISOString(),
        objectCount: objects.length,
        bytes: dump.length + objects.reduce((sum, o) => sum + o.bytes, 0),
        databaseHash: manifest.databaseHash,
        manifestHash: hash(manifestBytes),
      })
      await durableJson(resolve(directory, 'index.json'), index)
      await sql(
        ctx,
        `update loopmark_private.recovery_points set state='complete',completed_at=now(),object_count=${index.objectCount},bytes=${index.bytes},database_hash=${quote(index.databaseHash)},manifest_hash=${quote(index.manifestHash)} where id=${quote(id)}::uuid`,
      )
      return index
    } catch (error) {
      await durableJson(resolve(directory, 'index.json'), { ...index, state: 'incomplete' }).catch(
        () => {},
      )
      await sql(
        ctx,
        `update loopmark_private.recovery_points set state='incomplete' where id=${quote(id)}::uuid`,
      ).catch(() => {})
      throw error
    }
  } finally {
    await snapshot.close()
  }
}
async function verifyManifest(ctx, manifest, directory, key) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.projectId !== ctx.config.projectId ||
    !uuid.test(manifest.id) ||
    !Array.isArray(manifest.objects) ||
    manifest.objects.length > 100_000
  )
    throw new OpsError('MEDIA_INVALID')
  const dump = await decrypt(resolve(directory, 'database.enc'), key)
  if (hash(dump) !== manifest.databaseHash) throw new OpsError('MEDIA_INVALID')
  const seen = new Set()
  for (const object of manifest.objects) {
    if (
      !uuid.test(object.ownerId) ||
      !object.key.startsWith(object.ownerId + '/') ||
      object.file !== hash(object.key) + '.enc' ||
      seen.has(object.key) ||
      object.bytes < 1 ||
      object.bytes > 8388608
    )
      throw new OpsError('MEDIA_INVALID')
    seen.add(object.key)
    const bytes = await decrypt(resolve(directory, object.file), key)
    if (bytes.length !== object.bytes || hash(bytes) !== object.sha256)
      throw new OpsError('MEDIA_INVALID')
  }
  return dump
}
export async function verifyPoint(ctx, id) {
  const directory = pointDirectory(ctx, id),
    key = await recoveryKey(ctx),
    index = await readJson(resolve(directory, 'index.json'))
  if (index.state !== 'complete' || Date.parse(index.expiresAt) <= Date.now())
    throw new OpsError('NOT_AVAILABLE')
  const raw = await decrypt(resolve(directory, 'manifest.enc'), key),
    manifest = JSON.parse(raw)
  if (
    hash(raw) !== index.manifestHash ||
    manifest.id !== id ||
    manifest.expiresAt !== index.expiresAt
  )
    throw new OpsError('MEDIA_INVALID')
  await verifyManifest(ctx, manifest, directory, key)
  return { index, manifest, key, directory }
}
export async function expirePoints(ctx, limit = 20, now = Date.now()) {
  await cleanupExpiredDrills(ctx, limit, now)
  const directories = await readdir(ctx.recovery).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const key = directories.length ? await recoveryKey(ctx) : null
  const due = JSON.parse(
    await sql(
      ctx,
      `select coalesce(jsonb_agg(id),'[]') from (select id from loopmark_private.recovery_points where removed_at is null and expires_at<=${quote(new Date(now).toISOString())}::timestamptz order by expires_at,id limit ${limit}) p`,
    ),
  )
  const ids = [...new Set([...due, ...directories.filter((id) => uuid.test(id))])]
  let changed = 0
  for (const id of ids) {
    if (changed >= limit) break
    const directory = pointDirectory(ctx, id),
      index = await readJson(resolve(directory, 'index.json')).catch((error) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
    if (index) {
      const names = await readdir(directory)
      let expiresAt = index.expiresAt
      if (names.some((name) => name.endsWith('.enc'))) {
        const manifest = JSON.parse(await decrypt(resolve(directory, 'manifest.enc'), key))
        if (manifest.id !== id || manifest.projectId !== ctx.config.projectId)
          throw new OpsError('MEDIA_INVALID')
        expiresAt = manifest.expiresAt
      }
      if (Date.parse(expiresAt) > now) continue
      await rm(directory, { recursive: true, force: false })
      const parent = await open(ctx.recovery, 'r')
      try {
        await parent.sync()
      } finally {
        await parent.close()
      }
    } else if (!due.includes(id)) continue
    // Rechecking an absent exact directory also repairs a crash after removal but before catalog commit.
    if (
      (
        await readdir(ctx.recovery).catch((error) => {
          if (error.code === 'ENOENT') return []
          throw error
        })
      ).includes(id)
    )
      throw new OpsError('SERVICE_UNAVAILABLE')
    await sql(
      ctx,
      `begin;update loopmark_private.recovery_points set state='expired',removed_at=now() where id=${quote(id)}::uuid;delete from loopmark_private.recovery_pins where point_id=${quote(id)};commit;`,
    )
    changed++
  }
  await rpc(ctx, 'loopmark_ops_retention', { p_limit: limit })
  return changed
}
export async function replayErasure(ctx, inventory, database = 'postgres', signal) {
  for (const intent of inventory.entries) {
    if (signal?.aborted) throw new OpsError('CANCELLED')
    await sql(
      ctx,
      `begin;select set_config('request.jwt.claims','{"role":"service_role"}',true);select public.loopmark_erasure_replay(${quote(JSON.stringify(intent))}::jsonb,${quote(inventory.watermark)});commit;`,
      database,
    )
  }
}
export async function restoreCheck(
  ctx,
  id,
  { signal, ledgerReader = currentLedger, inspect } = {},
) {
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(240000)])
    : AbortSignal.timeout(240000)
  const readLedger = () =>
    new Promise((resolve, reject) => {
      const cancel = () => reject(new OpsError('CANCELLED'))
      if (signal.aborted) return cancel()
      signal.addEventListener('abort', cancel, { once: true })
      Promise.resolve(ledgerReader(ctx))
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', cancel))
    })
  const began = Date.now(),
    { index, manifest, key, directory } = await verifyPoint(ctx, id)
  const restoreId = randomUUID(),
    database = 'lm_restore_' + restoreId.replaceAll('-', ''),
    destination = resolve('.gstack/restores', ctx.config.profile, restoreId)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const result = {
    schemaVersion: 1,
    id: restoreId,
    pointId: id,
    ready: false,
    database,
    objectCount: 0,
    erasedAccounts: 0,
  }
  await sql(
    ctx,
    `insert into loopmark_private.restore_drills(id,point_id,expires_at,owner_pid) values(${quote(restoreId)}::uuid,${quote(id)}::uuid,now()+interval '5 minutes',${process.pid})`,
  )
  await durableJson(resolve(destination, 'gate.json'), result)
  try {
    const inventory = await readLedger()
    if (signal.aborted) throw new OpsError('CANCELLED')
    await sql(ctx, `create database ${database} template template0;`)
    const dump = await decrypt(resolve(directory, 'database.enc'), key)
    await run(
      'docker',
      [
        'exec',
        '-i',
        ctx.database,
        'pg_restore',
        '-U',
        'supabase_admin',
        '-d',
        database,
        '--exit-on-error',
      ],
      { input: dump, timeout: 180_000, maxBytes: 1024 * 1024, signal },
    )
    await sql(
      ctx,
      `truncate loopmark_private.restore_gate;insert into loopmark_private.restore_gate(point_id,ready,database_hash,manifest_hash) values(${quote(id)}::uuid,false,${quote(index.databaseHash)},${quote(index.manifestHash)});`,
      database,
    )
    await synchronizeRecoveryCatalog(ctx, database)
    await sql(ctx, 'delete from auth.sessions;', database)
    const erased = new Set(inventory.entries.map((entry) => entry.accountId))
    for (let offset = 0; offset < inventory.entries.length; offset += 50) {
      if (signal.aborted) throw new OpsError('CANCELLED')
      const batch = inventory.entries.slice(offset, offset + 50)
      await sql(
        ctx,
        `begin;select set_config('request.jwt.claims','{"role":"service_role"}',true);${batch.map((intent) => `select public.loopmark_restore_erasure(${quote(JSON.stringify(intent))}::jsonb,${quote(inventory.watermark)});`).join('')}commit;`,
        database,
      )
    }
    for (const object of manifest.objects) {
      if (signal.aborted) throw new OpsError('CANCELLED')
      if (erased.has(object.ownerId)) continue
      const bytes = await decrypt(resolve(directory, object.file), key)
      if (hash(bytes) !== object.sha256) throw new OpsError('MEDIA_INVALID')
      await encrypt(resolve(destination, object.file), bytes, key)
      if (hash(await decrypt(resolve(destination, object.file), key)) !== object.sha256)
        throw new OpsError('MEDIA_INVALID')
      result.objectCount++
    }
    const final = await readLedger()
    if (final.watermark !== inventory.watermark) throw new OpsError('SERVICE_UNAVAILABLE')
    const remaining = await sql(
      ctx,
      `select count(*) from loopmark_private.accounts where state='active' and id=any(array[${inventory.entries.length ? inventory.entries.map((e) => quote(e.accountId) + '::uuid').join(',') : 'null::uuid'}]);`,
      database,
    )
    if (remaining !== '0') throw new OpsError('SERVICE_UNAVAILABLE')
    await sql(
      ctx,
      `update loopmark_private.restore_gate set ready=true,ledger_watermark=${quote(final.watermark)},verified_at=now();`,
      database,
    )
    Object.assign(result, {
      ready: true,
      erasedAccounts: erased.size,
      ledgerWatermark: final.watermark,
      rtoMs: Date.now() - began,
      rpoMs: began - Date.parse(manifest.createdAt),
      rtoTargetMet: Date.now() - began <= 4 * 3600000,
      rpoTargetMet: began - Date.parse(manifest.createdAt) <= day,
    })
    await durableJson(resolve(destination, 'gate.json'), result)
    if (inspect) await inspect({ ...result, destination })
    return { ...result, destination }
  } catch (error) {
    await durableJson(resolve(destination, 'gate.json'), result)
    throw error
  } finally {
    await cleanupDrill(ctx, restoreId)
    await durableJson(
      resolve('.gstack/restore-evidence', ctx.config.profile, restoreId + '.json'),
      result,
    )
  }
}

export async function recoveredBytes(ctx, restoreResult, objectKey) {
  if (!/^lm_restore_[a-f0-9]{32}$/.test(restoreResult.database) || !uuid.test(restoreResult.id))
    throw new OpsError('VALIDATION')
  const directory = resolve('.gstack/restores', ctx.config.profile, restoreResult.id)
  const gate = await readJson(resolve(directory, 'gate.json'))
  if (!gate.ready || gate.database !== restoreResult.database) throw new OpsError('NOT_AVAILABLE')
  return await decrypt(resolve(directory, hash(objectKey) + '.enc'), await recoveryKey(ctx))
}

async function synchronizePoint(ctx, manifest, index, database = 'postgres') {
  await sql(
    ctx,
    `insert into loopmark_private.recovery_points(id,state,snapshot_id,created_at,completed_at,expires_at,database_hash,manifest_hash,object_count,bytes)
    values(${quote(manifest.id)}::uuid,${quote(index.state === 'complete' ? 'complete' : 'incomplete')},${quote(manifest.snapshotId)},${quote(manifest.createdAt)}::timestamptz,${index.completedAt ? quote(index.completedAt) : 'null'}::timestamptz,${quote(manifest.expiresAt)}::timestamptz,${quote(index.databaseHash)},${quote(index.manifestHash)},${manifest.objects.length},${index.bytes})
    on conflict(id) do update set state=excluded.state,expires_at=excluded.expires_at,database_hash=excluded.database_hash,manifest_hash=excluded.manifest_hash,object_count=excluded.object_count,bytes=excluded.bytes,removed_at=null;`,
    database,
  )
  for (let offset = 0; offset < (manifest.accounts ?? []).length; offset += 100)
    await sql(
      ctx,
      `insert into loopmark_private.recovery_accounts(point_id,owner_id) values ${manifest.accounts
        .slice(offset, offset + 100)
        .map((owner) => `(${quote(manifest.id)}::uuid,${quote(owner)}::uuid)`)
        .join(',')} on conflict do nothing;`,
      database,
    )
  for (let offset = 0; offset < manifest.objects.length; offset += 100) {
    const objects = manifest.objects.slice(offset, offset + 100)
    await sql(
      ctx,
      `insert into loopmark_private.recovery_objects(point_id,owner_id,object_key,sha256,bytes) values ${objects.map((o) => `(${quote(manifest.id)}::uuid,${quote(o.ownerId)}::uuid,${quote(o.key)},${quote(o.sha256)},${o.bytes})`).join(',')} on conflict do nothing;`,
      database,
    )
  }
}
async function synchronizeRecoveryCatalog(ctx, database) {
  const ids = (await readdir(ctx.recovery)).filter((id) => uuid.test(id)),
    key = await recoveryKey(ctx)
  for (const id of ids) {
    const directory = pointDirectory(ctx, id),
      index = await readJson(resolve(directory, 'index.json'))
    const manifestBytes = await decrypt(resolve(directory, 'manifest.enc'), key).catch(
      async (error) => {
        if ((await readdir(directory)).some((name) => name.endsWith('.enc'))) throw error
        return null
      },
    )
    if (!manifestBytes) continue
    const manifest = JSON.parse(manifestBytes)
    if (manifest.id !== id || manifest.projectId !== ctx.config.projectId)
      throw new OpsError('MEDIA_INVALID')
    // Even incomplete or expired-but-not-removed bytes must remain visible to retention accounting.
    if (index.state === 'complete') await verifyManifest(ctx, manifest, directory, key)
    await synchronizePoint(
      ctx,
      manifest,
      { ...index, databaseHash: manifest.databaseHash ?? '', manifestHash: hash(manifestBytes) },
      database,
    )
  }
}

export async function cleanupDrill(ctx, id) {
  if (!uuid.test(id)) throw new OpsError('VALIDATION')
  const registered = await sql(
    ctx,
    `select count(*) from loopmark_private.restore_drills where id=${quote(id)}::uuid`,
  )
  if (registered !== '1') throw new OpsError('NOT_AVAILABLE')
  const database = 'lm_restore_' + id.replaceAll('-', ''),
    directory = resolve('.gstack/restores', ctx.config.profile, id)
  await sql(ctx, `drop database if exists ${database} with (force);`)
  await rm(directory, { recursive: true, force: true })
  const parent = await open(resolve(directory, '..'), 'r')
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
  await sql(
    ctx,
    `update loopmark_private.restore_drills set removed_at=now() where id=${quote(id)}::uuid`,
  )
}
export async function cleanupExpiredDrills(ctx, limit = 20, now = Date.now()) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new OpsError('VALIDATION')
  const ids = JSON.parse(
    await sql(
      ctx,
      `select coalesce(jsonb_agg(x),'[]') from (select id,owner_pid from loopmark_private.restore_drills where removed_at is null and expires_at<=${quote(new Date(now).toISOString())}::timestamptz order by expires_at,id limit ${limit}) x`,
    ),
  )
  let removed = 0
  for (const item of ids) {
    if (item.owner_pid === 0) continue
    try {
      process.kill(item.owner_pid, 0)
      continue
    } catch (error) {
      if (error.code !== 'ESRCH') continue
    }
    await cleanupDrill(ctx, item.id)
    removed++
  }
  return removed
}
