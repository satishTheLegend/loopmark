import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { localEnvironment, request, sql, quote, actor, type Actor } from './helpers'
import { localContext } from '../../scripts/local.mjs'
const run = promisify(execFile)
export async function adminClient() {
  const env = await localEnvironment()
  return createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
export async function adminRpc(name: string, args: Record<string, unknown>) {
  const result = await (await adminClient()).rpc(name, args)
  if (result.error)
    throw new Error(
      `Billing fixture RPC ${name} failed: ${/^[A-Z_]+$/.test(result.error.message) ? result.error.message : result.error.code}`,
    )
  return result.data
}
export async function fixture(body: unknown) {
  const env = await localEnvironment()
  const result = await run('docker', [
    'exec',
    `loopmark_billing_fixture_${env.projectId}`,
    'node',
    '--input-type=module',
    '-e',
    "const response=await fetch('http://127.0.0.1:8788/control',{method:'POST',headers:{authorization:'Bearer '+process.env.LOOPMARK_BILLING_FIXTURE_KEY,'content-type':'application/json'},body:process.argv[1]});if(!response.ok)process.exit(2);process.stdout.write(await response.text())",
    JSON.stringify(body),
  ])
  return JSON.parse(result.stdout)
}
export async function fixtureSecret() {
  const context = await localContext()
  return 'fixture_' + (await readFile(resolve(context.runtime, 'billing-fixture.key'), 'utf8'))
}
export const webProduct = {
  id: 'loopmark.lifetime',
  provider: 'razorpay',
  title: 'Synthetic one-time upgrade',
  currency: 'INR',
  amountMinor: 49900,
  displayPrice: '₹499.00',
}
export const nativeProduct = { ...webProduct, id: 'loopmark.lifetime.ios', provider: 'revenuecat' }
export async function seedBilling() {
  for (const [product, providerProduct] of [
    [webProduct, webProduct.id],
    [nativeProduct, 'prodSyntheticIOS'],
    [{ ...nativeProduct, id: 'loopmark.lifetime.android' }, 'prodSyntheticAndroid'],
  ] as const)
    await adminRpc('loopmark_billing_catalog_set', {
      p_provider: product.provider,
      p_environment: 'sandbox',
      p_provider_product: providerProduct,
      p_product: product,
      p_enabled: true,
      p_authorization: randomUUID(),
    })
}
export async function prepare(a: Actor, id = randomUUID()) {
  const body = {
    action: 'prepare',
    attemptId: id,
    productId: webProduct.id,
    collection: a.session.collection,
  }
  return { input: body, response: await request(a.token, 'checkout', body) }
}
export async function capture(a: Actor) {
  const prepared = await prepare(a)
  if (prepared.response.status !== 200 || prepared.response.body.status !== 'ready')
    throw new Error('Synthetic checkout preparation failed')
  const payment = await fixture({ action: 'payment', attemptId: prepared.input.attemptId })
  return { attemptId: prepared.input.attemptId, ...payment }
}
export async function verify(
  a: Actor,
  payment: { attemptId: string; paymentLinkId: string; paymentId: string },
) {
  const signature = createHmac('sha256', await fixtureSecret())
    .update(`${payment.paymentLinkId}|${payment.attemptId}|paid|${payment.paymentId}`)
    .digest('hex')
  return await request(a.token, 'checkout', {
    action: 'verify',
    ...payment,
    paymentLinkStatus: 'paid',
    signature,
  })
}
export async function recent(a: Actor) {
  const challengeId = randomUUID(),
    proof = randomBytes(32).toString('hex'),
    hash = createHash('sha256').update(proof).digest('hex')
  const expiresAt = await adminRpc('loopmark_issue_reauthentication', {
    p_owner: a.id,
    p_challenge: challengeId,
    p_hash: hash,
  })
  return { challengeId, proof, expiresAt }
}
export async function nativePurchase(a: Actor, overrides: Record<string, unknown> = {}) {
  const id = 'purc' + randomUUID().replaceAll('-', '')
  const purchase = {
    id,
    customer_id: a.session.billingPrincipalId,
    original_customer_id: a.session.billingPrincipalId,
    product_id: 'prodSyntheticIOS',
    status: 'owned',
    environment: 'sandbox',
    store: 'app_store',
    ownership: 'purchased',
    store_purchase_identifier: randomUUID(),
    ...overrides,
  }
  await fixture({ action: 'revenuecat', purchase })
  return purchase
}
export async function restore(a: Actor) {
  return await request(a.token, 'purchase-restore', {
    action: 'reconcile',
    requestId: randomUUID(),
    provider: 'revenuecat',
  })
}
export async function webhook(eventId: string, body: unknown, signature?: string) {
  const env = await localEnvironment(),
    raw = JSON.stringify(body),
    response = await fetch(`${env.url}/functions/v1/billing-webhook/razorpay`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-event-id': eventId,
        'x-razorpay-signature':
          signature ??
          createHmac('sha256', await fixtureSecret())
            .update(raw)
            .digest('hex'),
      },
      body: raw,
    })
  return { status: response.status, body: await response.json() }
}
export async function jobs() {
  const env = await localEnvironment()
  return await request(env.serviceKey, 'jobs', { action: 'reconcile-purchases', limit: 20 })
}

export async function deletedPurchase() {
  const a = await actor(),
    paid = await capture(a)
  await verify(a, paid)
  const recoveryKey = randomBytes(32).toString('hex')
  const saved = await request(a.token, 'purchase-recovery', {
    action: 'set-key',
    requestId: randomUUID(),
    nextRecoveryKeyHash: createHash('sha256').update(recoveryKey).digest('hex'),
  })
  if (saved.body.status !== 'key-saved') throw new Error('Synthetic recovery key failed')
  await deleteActor(a)
  return { a, paid, recoveryKey }
}
export async function deleteActor(a: Actor) {
  const response = await request(a.token, 'account-delete', {
    requestId: randomUUID(),
    receiptTokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    reauthentication: await recent(a),
  })
  if (response.status !== 200) throw new Error('Synthetic billing deletion failed')
  await sql(
    `update loopmark_private.deletion_requests set purge_after=now()-interval '1 second' where owner_id=${quote(a.id)}::uuid;update loopmark_private.jobs set next_attempt=now()-interval '1 second' where owner_id=${quote(a.id)}::uuid`,
  )
  const env = await localEnvironment(),
    jobs = await request(env.serviceKey, 'jobs', {
      action: 'resume-deletions',
      limit: 1,
      ownerId: a.id,
    })
  if (jobs.body.counts.failed !== 0) throw new Error('Synthetic billing purge failed')
}
export async function nativeWebhook(event: unknown, authorization?: string) {
  const env = await localEnvironment(),
    response = await fetch(`${env.url}/functions/v1/billing-webhook/revenuecat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authorization ?? (await fixtureSecret()),
      },
      body: JSON.stringify({ event }),
    })
  return { status: response.status, body: await response.json() }
}
