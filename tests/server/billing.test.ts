import { beforeAll, describe, expect, it } from 'vitest'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { actor, request, sql, quote, localEnvironment } from './helpers'
import {
  deleteActor,
  deletedPurchase,
  adminClient,
  adminRpc,
  capture,
  fixture,
  jobs,
  nativePurchase,
  nativeWebhook,
  prepare,
  recent,
  restore,
  seedBilling,
  verify,
  webhook,
  webProduct,
} from './billing-fixtures'
beforeAll(seedBilling)
describe('I08 actual local SQL/HTTP with explicitly synthetic provider contract fixture', () => {
  it('keeps product/identity/entitlement authority server-side and native config public-only', async () => {
    const a = await actor(),
      products = await request(a.token, 'checkout', { action: 'products' })
    expect(products.status, JSON.stringify(products.body)).toBe(200)
    expect(products.body.products).toEqual([webProduct])
    expect((await request('', 'checkout', { action: 'products' })).status).toBe(401)
    const forged = await request(a.token, 'checkout', {
      action: 'prepare',
      attemptId: randomUUID(),
      productId: webProduct.id,
      collection: a.session.collection,
      amountMinor: 1,
      upgraded: true,
    })
    expect(forged.status).toBe(400)
    const direct = await a.client.rpc('loopmark_billing_observe', {
      p_provider: 'razorpay',
      p_environment: 'sandbox',
      p_purchase: 'pay_forged',
      p_fence: 1,
      p_principal: a.session.billingPrincipalId,
      p_product: webProduct.id,
      p_state: 'valid',
      p_observation: 'forged',
    })
    expect(direct.error).toBeTruthy()
    const config = await request(a.token, 'billing-config', { platform: 'ios' })
    expect(config.status, JSON.stringify(config.body)).toBe(200)
    expect(Object.keys(config.body).sort()).toEqual([
      'environment',
      'platform',
      'productIds',
      'publicSdkKey',
    ])
    expect(config.body.productIds).toEqual(['loopmark.lifetime.ios'])
  })
  it('deduplicates concurrent preparation and recovers a lost provider creation response by stable reference', async () => {
    const a = await actor(),
      id = randomUUID(),
      input = {
        action: 'prepare',
        attemptId: id,
        productId: webProduct.id,
        collection: a.session.collection,
      }
    const pair = await Promise.all([
      request(a.token, 'checkout', input),
      request(a.token, 'checkout', input),
    ])
    expect(pair.every((value) => value.status === 200)).toBe(true)
    const ready = await request(a.token, 'checkout', input)
    expect(ready.body.status).toBe('ready')
    const b = await actor()
    await fixture({ action: 'behavior', path: '/v1/payment_links/', drop: true })
    const lost = await prepare(b)
    expect(lost.response.status).toBe(503)
    await sql(
      `update loopmark_private.purchase_attempts set create_lease_until=now()-interval '1 second' where id=${quote(lost.input.attemptId)}::uuid`,
    )
    const retried = await request(b.token, 'checkout', lost.input)
    expect(retried.status, JSON.stringify(retried.body)).toBe(200)
    expect(retried.body.status).toBe('ready')
    const inventory = await fixture({ action: 'inventory' })
    expect(
      inventory.links.filter(
        (link: { reference_id: string }) => link.reference_id === lost.input.attemptId,
      ),
    ).toHaveLength(1)
  })
  it('verifies bound hosted callbacks and captured payment; rejects mismatched account and amount', async () => {
    const a = await actor(),
      paid = await capture(a),
      other = await actor()
    expect(
      (await request(other.token, 'checkout', { action: 'status', attemptId: paid.attemptId }))
        .status,
    ).toBe(404)
    const bad = await request(a.token, 'checkout', {
      action: 'verify',
      ...paid,
      paymentLinkStatus: 'paid',
      signature: '0'.repeat(64),
    })
    expect(bad.status).toBe(404)
    const verified = await verify(a, paid)
    expect(verified.status, JSON.stringify(verified.body)).toBe(200)
    expect(verified.body.entitlement.upgraded).toBe(true)
    expect((await verify(a, paid)).body.entitlement.upgraded).toBe(true)
    expect(
      await sql(
        `select count(*) from loopmark_private.purchase_grants where principal_id=${quote(a.session.billingPrincipalId)}::uuid`,
      ),
    ).toBe('1')
    const b = await actor(),
      altered = await capture(b)
    await fixture({ action: 'payment', attemptId: altered.attemptId, amount: 1 })
    expect((await verify(b, altered)).status).toBe(404)
    expect(
      (await request(b.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(false)
  })
  it('authenticates raw webhooks before durable acknowledgement and deduplicates replay', async () => {
    const a = await actor(),
      paid = await capture(a),
      id = randomUUID(),
      body = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: paid.paymentId, email: 'never retain this' } } },
      }
    expect((await webhook(id, body, '0'.repeat(64))).status).toBe(401)
    expect((await webhook(id, body)).status).toBe(200)
    expect((await webhook(id, body)).status).toBe(200)
    expect((await webhook(id, { ...body, event: 'payment.authorized' })).status).toBe(409)
    expect(
      await sql(`select count(*) from loopmark_private.webhook_inbox where event_id=${quote(id)}`),
    ).toBe('1')
    expect(
      await sql(
        `select payload::text from loopmark_private.webhook_inbox where event_id=${quote(id)}`,
      ),
    ).not.toContain('never retain')
    const done = await jobs()
    expect(done.status, JSON.stringify(done.body)).toBe(200)
    expect(
      (await request(a.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(true)
  })
  it('does not acknowledge an inbox transaction that failed before durable insert', async () => {
    const id = randomUUID(),
      body = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_syntheticMissing' } } },
      }
    await sql(
      `create function loopmark_private.test_billing_inbox_failure() returns trigger language plpgsql as $$ begin if NEW.event_id=${quote(id)} then raise exception 'SERVICE_UNAVAILABLE';end if;return NEW;end $$;create trigger test_billing_inbox_failure before insert on loopmark_private.webhook_inbox for each row execute function loopmark_private.test_billing_inbox_failure()`,
    )
    try {
      expect((await webhook(id, body)).status).toBe(503)
      expect(
        await sql(
          `select count(*) from loopmark_private.webhook_inbox where event_id=${quote(id)}`,
        ),
      ).toBe('0')
    } finally {
      await sql(
        'drop trigger test_billing_inbox_failure on loopmark_private.webhook_inbox;drop function loopmark_private.test_billing_inbox_failure()',
      )
    }
  })
  it('derives ANY-valid cross-provider access and handles sequential and simultaneous refunds', async () => {
    const a = await actor(),
      web = await capture(a)
    await verify(a, web)
    const native = await nativePurchase(a)
    expect((await restore(a)).body.entitlement.upgraded).toBe(true)
    await fixture({ action: 'payment', attemptId: web.attemptId, state: 'refunded' })
    expect(
      (await request(a.token, 'checkout', { action: 'status', attemptId: web.attemptId })).body
        .entitlement.upgraded,
    ).toBe(true)
    await fixture({ action: 'revenuecat', purchase: { ...native, status: 'refunded' } })
    expect((await restore(a)).body.entitlement.upgraded).toBe(false)
    const b = await actor(),
      web2 = await capture(b),
      native2 = await nativePurchase(b)
    await verify(b, web2)
    await restore(b)
    await fixture({ action: 'payment', attemptId: web2.attemptId, state: 'refunded' })
    await fixture({ action: 'revenuecat', purchase: { ...native2, status: 'refunded' } })
    await Promise.all([
      request(b.token, 'checkout', { action: 'status', attemptId: web2.attemptId }),
      restore(b),
    ])
    expect(
      (await request(b.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(false)
  })
  it('rejects stale purchase fences and production grants in a sandbox ledger', async () => {
    const a = await actor(),
      purchase = 'pay_' + randomUUID().replaceAll('-', ''),
      args = { p_provider: 'razorpay', p_environment: 'sandbox', p_purchase: purchase }
    const first = await adminRpc('loopmark_billing_purchase_claim', args)
    await sql(
      `update loopmark_private.purchase_leases set expires_at=now()-interval '1 second' where purchase_id=${quote(purchase)}`,
    )
    const second = await adminRpc('loopmark_billing_purchase_claim', args),
      admin = await adminClient(),
      observation = {
        ...args,
        p_principal: a.session.billingPrincipalId,
        p_product: webProduct.id,
        p_state: 'valid',
        p_observation: randomUUID(),
      }
    expect(
      (await admin.rpc('loopmark_billing_observe', { ...observation, p_fence: first })).error
        ?.message,
    ).toBe('NOT_AVAILABLE')
    expect(
      (await admin.rpc('loopmark_billing_observe', { ...observation, p_fence: second })).error,
    ).toBeNull()
    expect(
      (await admin.rpc('loopmark_billing_purchase_claim', { ...args, p_environment: 'production' }))
        .error?.message,
    ).toBe('CAPABILITY_UNAVAILABLE')
  })
  it('keeps wrong native ownership and sandbox claims from granting access', async () => {
    const a = await actor(),
      other = await actor()
    await nativePurchase(a, { original_customer_id: other.session.billingPrincipalId })
    await restore(a)
    expect(
      (await request(a.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(false)
    const b = await actor()
    await nativePurchase(b, { environment: 'production' })
    await restore(b)
    expect(
      (await request(b.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(false)
  })
  it('fetches disputes authoritatively and preserves revocation across delayed paid events', async () => {
    const a = await actor(),
      paid = await capture(a)
    await verify(a, paid)
    const dispute = {
      id: 'disp_' + randomUUID().replaceAll('-', ''),
      payment_id: paid.paymentId,
      status: 'open',
    }
    await fixture({ action: 'dispute', dispute })
    await webhook(randomUUID(), {
      event: 'payment.dispute.created',
      payload: { dispute: { entity: dispute } },
    })
    await jobs()
    const status = await request(a.token, 'checkout', {
      action: 'status',
      attemptId: paid.attemptId,
    })
    expect(status.body.attempt.state).toBe('disputed')
    expect(status.body.entitlement.upgraded).toBe(false)
    await webhook(randomUUID(), {
      event: 'payment.captured',
      payload: { payment: { entity: { id: paid.paymentId } } },
    })
    await jobs()
    expect(
      (await request(a.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(false)
  })
  it('requires fresh authentication and independent ownership, rotates recovery keys and never recreates craft', async () => {
    const a = await actor(),
      paid = await capture(a)
    await verify(a, paid)
    const key = randomBytes(32).toString('hex'),
      hash = createHash('sha256').update(key).digest('hex'),
      saved = { action: 'set-key', requestId: randomUUID(), nextRecoveryKeyHash: hash }
    expect((await request(a.token, 'purchase-recovery', saved)).body.status).toBe('key-saved')
    expect((await request(a.token, 'purchase-recovery', saved)).body.status).toBe('key-saved')
    const receiptToken = randomBytes(32).toString('hex'),
      deletion = await request(a.token, 'account-delete', {
        requestId: randomUUID(),
        receiptTokenHash: createHash('sha256').update(receiptToken).digest('hex'),
        reauthentication: await recent(a),
      })
    expect(deletion.status).toBe(200)
    await sql(
      `update loopmark_private.deletion_requests set purge_after=now()-interval '1 second' where owner_id=${quote(a.id)}::uuid;update loopmark_private.jobs set next_attempt=now()-interval '1 second' where owner_id=${quote(a.id)}::uuid`,
    )
    const env = await localEnvironment()
    expect(
      (
        await request(env.serviceKey, 'jobs', {
          action: 'resume-deletions',
          limit: 1,
          ownerId: a.id,
        })
      ).body.counts.failed,
    ).toBe(0)
    const b = await actor(),
      newKey = randomBytes(32).toString('hex'),
      nextHash = createHash('sha256').update(newKey).digest('hex'),
      claim = {
        action: 'claim',
        requestId: randomUUID(),
        provider: 'razorpay',
        evidenceId: paid.paymentId,
        recoveryKey: key,
        nextRecoveryKeyHash: nextHash,
        reauthentication: await recent(b),
      }
    const recovered = await request(b.token, 'purchase-recovery', claim)
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200)
    expect(recovered.body.status).toBe('recovered')
    expect(recovered.body.entitlement.upgraded).toBe(true)
    expect((await request(b.token, 'purchase-recovery', claim)).body.status).toBe('recovered')
    expect(
      await sql(
        `select recovery_key_hash from loopmark_private.billing_principals where id=${quote(a.session.billingPrincipalId)}::uuid`,
      ),
    ).toBe(nextHash)
    expect(
      await sql(
        `select count(*) from loopmark_private.projects where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('0')
    expect(await sql(`select count(*) from auth.users where id=${quote(a.id)}::uuid`)).toBe('0')
    await webhook(randomUUID(), {
      event: 'payment.captured',
      payload: { payment: { entity: { id: paid.paymentId } } },
    })
    await jobs()
    expect(
      await sql(
        `select count(*) from loopmark_private.entitlement_projection where account_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('0')
  })
  it('fences an actual delayed stale provider response after a newer refund observation', async () => {
    const a = await actor(),
      paid = await capture(a)
    await verify(a, paid)
    const path = '/v1/payments/' + paid.paymentId
    await fixture({ action: 'behavior', path, delay: 2000 })
    const older = request(a.token, 'checkout', { action: 'status', attemptId: paid.attemptId })
    await new Promise((resolve) => setTimeout(resolve, 500))
    await sql(
      `update loopmark_private.purchase_leases set expires_at=now()-interval '1 second' where purchase_id=${quote(paid.paymentId)}`,
    )
    await fixture({ action: 'payment', attemptId: paid.attemptId, state: 'refunded' })
    await fixture({ action: 'behavior', path, delay: 0 })
    const newer = await request(a.token, 'checkout', {
      action: 'status',
      attemptId: paid.attemptId,
    })
    expect(newer.body.entitlement.upgraded).toBe(false)
    expect((await older).status).toBe(404)
    expect(
      (await request(a.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(false)
  })
  it('requires an explicit audited promotion allowlist and rejects repeated promotion', async () => {
    const a = await actor(),
      authorization = randomUUID(),
      admin = await adminClient()
    expect(
      (await admin.rpc('loopmark_billing_promote', { p_authorization: authorization })).error,
    ).toBeTruthy()
    await sql(
      `insert into loopmark_private.billing_promotion_allowlist values(${quote(authorization)}::uuid,${quote(a.id)}::uuid,'sandbox',now()+interval '1 hour')`,
    )
    expect(
      (await admin.rpc('loopmark_billing_promote', { p_authorization: authorization })).error,
    ).toBeNull()
    expect(
      (await admin.rpc('loopmark_billing_promote', { p_authorization: authorization })).error,
    ).toBeTruthy()
    expect(
      (await request(a.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(true)
    expect(
      await sql(
        `select count(*) from loopmark_private.audit_events where correlation_id=${quote(authorization)}::uuid and kind='purchase-promotion-authorized'`,
      ),
    ).toBe('1')
  })
  it('applies webhook backlog backpressure before 2xx while still acknowledging durable duplicates', async () => {
    const prefix = 'fixture-backpressure-' + randomUUID(),
      event = randomUUID(),
      body = { event: 'other.event', payload: {} }
    expect((await webhook(event, body)).status).toBe(200)
    await sql(
      `insert into loopmark_private.webhook_inbox(provider,environment,event_id,payload,payload_hash) select 'razorpay','sandbox',${quote(prefix)}||i::text,'{}','0000000000000000000000000000000000000000000000000000000000000000' from generate_series(1,10000) i`,
    )
    try {
      expect((await webhook(event, body)).status).toBe(200)
      expect((await webhook(randomUUID(), body)).status).toBe(503)
    } finally {
      await sql(
        `delete from loopmark_private.webhook_inbox where starts_with(event_id,${quote(prefix)})`,
      )
    }
  })
  it('keeps the confirmed amount immutable when the audited catalog changes later', async () => {
    const a = await actor(),
      prepared = await prepare(a),
      changed = { ...webProduct, amountMinor: 59900, displayPrice: '₹599.00' }
    await adminRpc('loopmark_billing_catalog_set', {
      p_provider: 'razorpay',
      p_environment: 'sandbox',
      p_provider_product: webProduct.id,
      p_product: changed,
      p_enabled: true,
      p_authorization: randomUUID(),
    })
    try {
      const retry = await request(a.token, 'checkout', prepared.input)
      expect(retry.body.product.amountMinor).toBe(49900)
      const paid = await fixture({ action: 'payment', attemptId: prepared.input.attemptId })
      expect(
        (await verify(a, { attemptId: prepared.input.attemptId, ...paid })).body.entitlement
          .upgraded,
      ).toBe(true)
    } finally {
      await seedBilling()
    }
  })
  it('serializes competing recovery claims and refuses to take an actively bound principal', async () => {
    const old = await deletedPurchase(),
      b = await actor(),
      c = await actor()
    const make = async (a: typeof b) => ({
      action: 'claim',
      requestId: randomUUID(),
      provider: 'razorpay',
      evidenceId: old.paid.paymentId,
      recoveryKey: old.recoveryKey,
      nextRecoveryKeyHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      reauthentication: await recent(a),
    })
    const bClaim = await make(b),
      cClaim = await make(c),
      responses = await Promise.all([
        request(b.token, 'purchase-recovery', bClaim),
        request(c.token, 'purchase-recovery', cClaim),
      ])
    expect(responses.filter((value) => value.body.status === 'recovered')).toHaveLength(1)
    const loser = responses[0].body.status === 'recovered' ? c : b,
      claim = loser === c ? cClaim : bClaim
    expect((await request(loser.token, 'purchase-recovery', claim)).status).toBe(404)
    expect(
      (await request(loser.token, 'purchase-restore', { action: 'status' })).body.entitlement
        .upgraded,
    ).toBe(false)
  })
  it('requires privileged independently verified support evidence for a lost key and rejects the rotated old key', async () => {
    const old = await deletedPurchase(),
      b = await actor(),
      newKey = randomBytes(32).toString('hex'),
      claim = {
        action: 'claim',
        requestId: randomUUID(),
        provider: 'razorpay',
        evidenceId: old.paid.paymentId,
        nextRecoveryKeyHash: createHash('sha256').update(newKey).digest('hex'),
        reauthentication: await recent(b),
      }
    const pending = await request(b.token, 'purchase-recovery', claim)
    expect(pending.body.status).toBe('pending')
    const evidence = {
      p_case: claim.requestId,
      p_source: old.a.session.billingPrincipalId,
      p_operator: randomUUID(),
      p_evidence: randomUUID(),
    }
    expect((await b.client.rpc('loopmark_billing_support_verify', evidence)).error).toBeTruthy()
    await adminRpc('loopmark_billing_support_verify', evidence)
    expect(
      (
        await request(b.token, 'purchase-recovery', {
          action: 'status',
          requestId: claim.requestId,
        })
      ).body.status,
    ).toBe('recovered')
    await deleteActor(b)
    const c = await actor(),
      oldClaim = {
        action: 'claim',
        requestId: randomUUID(),
        provider: 'razorpay',
        evidenceId: old.paid.paymentId,
        recoveryKey: old.recoveryKey,
        nextRecoveryKeyHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
        reauthentication: await recent(c),
      }
    expect((await request(c.token, 'purchase-recovery', oldClaim)).body.status).toBe('pending')
    expect(
      (await request(c.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(false)
    expect(
      await sql(
        `select count(*) from loopmark_private.audit_events where kind='purchase-support-ownership-verified' and correlation_id=${quote(evidence.p_evidence)}::uuid`,
      ),
    ).toBe('1')
  })
  it('authenticates native webhook hints and re-fetches original identified ownership before granting', async () => {
    const a = await actor()
    await nativePurchase(a)
    const event = {
      id: randomUUID(),
      type: 'NON_RENEWING_PURCHASE',
      environment: 'SANDBOX',
      original_app_user_id: a.session.billingPrincipalId,
    }
    expect((await nativeWebhook(event, 'wrong credential')).status).toBe(401)
    expect((await nativeWebhook({ ...event, environment: 'PRODUCTION' })).status).toBe(404)
    expect((await nativeWebhook(event)).status).toBe(200)
    expect((await nativeWebhook(event)).status).toBe(200)
    await jobs()
    expect(
      (await request(a.token, 'purchase-restore', { action: 'status' })).body.entitlement.upgraded,
    ).toBe(true)
    expect(
      await sql(
        `select count(*) from loopmark_private.webhook_inbox where provider='revenuecat' and event_id=${quote(event.id)}`,
      ),
    ).toBe('1')
  })
  it('releases cancelled or expired native admission without losing late purchase reconciliation', async () => {
    const a = await actor(),
      ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const attemptId = randomUUID()
      ids.push(attemptId)
      expect(
        (
          await request(a.token, 'purchase-restore', {
            action: 'prepare',
            attemptId,
            productId: 'loopmark.lifetime.ios',
            collection: a.session.collection,
          })
        ).status,
      ).toBe(200)
    }
    for (const attemptId of ids)
      expect(
        (await request(a.token, 'purchase-restore', { action: 'cancel', attemptId })).body.attempt
          .state,
      ).toBe('failed')
    const next = randomUUID()
    expect(
      (
        await request(a.token, 'purchase-restore', {
          action: 'prepare',
          attemptId: next,
          productId: 'loopmark.lifetime.ios',
          collection: a.session.collection,
        })
      ).status,
    ).toBe(200)
    await nativePurchase(a)
    await restore(a)
    expect(
      (await request(a.token, 'purchase-restore', { action: 'status', attemptId: next })).body
        .attempt.state,
    ).toBe('verified')
    const b = await actor()
    for (let i = 0; i < 4; i++)
      expect(
        (
          await request(b.token, 'purchase-restore', {
            action: 'prepare',
            attemptId: randomUUID(),
            productId: 'loopmark.lifetime.ios',
            collection: b.session.collection,
          })
        ).status,
      ).toBe(200)
    await sql(
      `update loopmark_private.purchase_attempts set expires_at=now()-interval '1 second' where owner_id=${quote(b.id)}::uuid`,
    )
    expect(
      (
        await request(b.token, 'purchase-restore', {
          action: 'prepare',
          attemptId: randomUUID(),
          productId: 'loopmark.lifetime.ios',
          collection: b.session.collection,
        })
      ).status,
    ).toBe(200)
  })
  it('cannot repopulate erased checkout navigation data from a late provider creation response', async () => {
    const a = await actor(),
      attemptId = randomUUID(),
      path = '/v1/payment_links/'
    await fixture({ action: 'behavior', path, delay: 6000 })
    const creating = prepare(a, attemptId)
    try {
      let seen = false
      for (let i = 0; i < 20; i++) {
        const inventory = await fixture({ action: 'inventory' })
        if (
          inventory.links.some((link: { reference_id: string }) => link.reference_id === attemptId)
        ) {
          seen = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(seen).toBe(true)
      await deleteActor(a)
      expect((await creating).response.status).toBe(404)
      expect(
        await sql(
          `select owner_id is null and checkout_url is null and provider_id is not null from loopmark_private.purchase_attempts where id=${quote(attemptId)}::uuid`,
        ),
      ).toBe('t')
    } finally {
      await fixture({ action: 'behavior', path, delay: 0 })
    }
  })
  it('bounds actual simultaneous purchase leases at four without discarding deferred identities', async () => {
    const ids = Array.from({ length: 5 }, () => 'pay_' + randomUUID().replaceAll('-', ''))
    try {
      const leases = await Promise.all(
        ids.map((p_purchase) =>
          adminRpc('loopmark_billing_purchase_claim', {
            p_provider: 'razorpay',
            p_environment: 'sandbox',
            p_purchase,
          }),
        ),
      )
      expect(leases.filter(Boolean)).toHaveLength(4)
      expect(
        await sql(
          `select count(*) from loopmark_private.purchase_leases where purchase_id=any(array[${ids.map(quote).join(',')}])`,
        ),
      ).toBe('5')
    } finally {
      await sql(
        `delete from loopmark_private.purchase_leases where purchase_id=any(array[${ids.map(quote).join(',')}])`,
      )
    }
  })
  it('resolves original native store receipts uniquely and resumes a saved pending claim', async () => {
    const a = await actor(),
      native = await nativePurchase(a),
      key = randomBytes(32).toString('hex')
    expect((await restore(a)).body.entitlement.upgraded).toBe(true)
    const hash = createHash('sha256').update(key).digest('hex')
    await request(a.token, 'purchase-recovery', {
      action: 'set-key',
      requestId: randomUUID(),
      nextRecoveryKeyHash: hash,
    })
    await deleteActor(a)
    const b = await actor(),
      requestId = randomUUID(),
      nextHash = 'b'.repeat(64)
    const duplicate = { ...native, id: 'purc' + randomUUID().replaceAll('-', '') }
    await fixture({ action: 'revenuecat', purchase: duplicate })
    const claim = {
      action: 'claim',
      requestId,
      provider: 'revenuecat',
      evidenceId: native.store_purchase_identifier,
      recoveryKey: key,
      nextRecoveryKeyHash: nextHash,
      reauthentication: await recent(b),
    }
    expect((await request(b.token, 'purchase-recovery', claim)).status).toBe(404)
    await fixture({
      action: 'revenuecat',
      purchase: { ...duplicate, store_purchase_identifier: 'different-store-receipt' },
    })
    const searchPath = '/v2/projects/projSynthetic1234/purchases'
    await fixture({
      action: 'behavior',
      path: searchPath,
      response: {
        items: [{ ...native, store_purchase_identifier: 'mismatched-receipt' }],
        next_page: null,
      },
    })
    try {
      expect(
        (await request(b.token, 'purchase-recovery', { action: 'status', requestId })).status,
      ).toBe(404)
    } finally {
      await fixture({ action: 'behavior', path: searchPath })
    }
    const recovered = await request(b.token, 'purchase-recovery', { action: 'status', requestId })
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200)
    expect(recovered.body.status).toBe('recovered')
    expect(recovered.body.entitlement.billingPrincipalId).toBe(a.session.billingPrincipalId)
    const status = await request(b.token, 'purchase-restore', { action: 'status' })
    expect(status.body.currentRecoveryKeyHash).toBe(nextHash)
    expect(
      await sql(
        `select purchase_id from loopmark_private.purchase_recovery_cases where id=${quote(requestId)}::uuid`,
      ),
    ).toBe(native.store_purchase_identifier)
  })
  it('reports only the current owned recovery hash while preserving historical key receipts', async () => {
    const a = await actor(),
      other = await actor(),
      first = randomUUID(),
      second = randomUUID()
    const before = await request(a.token, 'purchase-restore', { action: 'status' })
    expect(before.body.currentRecoveryKeyHash).toBeNull()
    await request(a.token, 'purchase-recovery', {
      action: 'set-key',
      requestId: first,
      nextRecoveryKeyHash: 'a'.repeat(64),
    })
    await request(a.token, 'purchase-recovery', {
      action: 'set-key',
      requestId: second,
      nextRecoveryKeyHash: 'b'.repeat(64),
      reauthentication: await recent(a),
    })
    expect(
      (await request(a.token, 'purchase-recovery', { action: 'status', requestId: first })).body
        .recoveryKeyHash,
    ).toBe('a'.repeat(64))
    expect(
      (await request(a.token, 'purchase-restore', { action: 'status' })).body
        .currentRecoveryKeyHash,
    ).toBe('b'.repeat(64))
    expect(
      (await request(other.token, 'purchase-restore', { action: 'status' })).body
        .currentRecoveryKeyHash,
    ).toBeNull()
    expect(
      (await request(other.token, 'purchase-recovery', { action: 'status', requestId: first }))
        .status,
    ).toBe(404)
  })
})
