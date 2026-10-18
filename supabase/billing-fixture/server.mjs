// Deterministic local provider contract fixture. Never represents provider sandbox qualification.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
const key = process.env.LOOPMARK_BILLING_FIXTURE_KEY
if (!/^[a-f0-9]{64}$/.test(key ?? '')) throw new Error('Fixture credential unavailable')
const links = new Map(),
  payments = new Map(),
  purchases = new Map(),
  disputes = new Map(),
  controls = new Map()
const opaque = (prefix) => prefix + '_' + randomUUID().replaceAll('-', '')
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://billing-fixture:8788'),
      chunks = []
    let length = 0
    for await (const chunk of request) {
      length += chunk.length
      if (length > 512 * 1024) {
        json(response, 413, { error: 'bounded' })
        return
      }
      chunks.push(chunk)
    }
    const body = length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    if (url.pathname === '/control') {
      if (request.headers.authorization !== `Bearer ${key}`) {
        json(response, 401, {})
        return
      }
      if (body.action === 'reset') {
        links.clear()
        payments.clear()
        purchases.clear()
        disputes.clear()
        controls.clear()
        json(response, 200, { reset: true })
        return
      }
      if (body.action === 'behavior') {
        controls.set(body.path, { delay: body.delay ?? 0, drop: body.drop ?? false })
        json(response, 200, { configured: true })
        return
      }
      if (body.action === 'inventory') {
        json(response, 200, { links: [...links.values()], payments: [...payments.values()] })
        return
      }
      if (body.action === 'payment') {
        const link = [...links.values()].find((value) => value.reference_id === body.attemptId)
        if (!link) {
          json(response, 404, {})
          return
        }
        const id = body.id ?? link.payments?.[0]?.payment_id ?? opaque('pay'),
          state = body.state ?? 'captured'
        const payment = {
          id,
          amount: body.amount ?? link.amount,
          currency: body.currency ?? link.currency,
          status: state,
          captured: state === 'captured' || state === 'refunded',
          amount_refunded: body.amountRefunded ?? (state === 'refunded' ? link.amount : 0),
          refund_status: state === 'refunded' ? 'full' : null,
          order_id: body.orderId ?? link.order_id,
        }
        payments.set(id, payment)
        link.payments = [{ payment_id: id, status: 'captured', amount: link.amount }]
        link.status = 'paid'
        link.amount_paid = link.amount
        json(response, 200, { paymentId: id, paymentLinkId: link.id })
        return
      }
      if (body.action === 'revenuecat') {
        purchases.set(body.purchase.id, body.purchase)
        json(response, 200, { id: body.purchase.id })
        return
      }
      if (body.action === 'dispute') {
        disputes.set(body.dispute.id, body.dispute)
        json(response, 200, { id: body.dispute.id })
        return
      }
      json(response, 400, {})
      return
    }
    const provider = url.pathname.startsWith('/v1/') ? 'razorpay' : 'revenuecat'
    const expected =
      provider === 'razorpay'
        ? `Basic ${Buffer.from('rzp_test_fixture:fixture_' + key).toString('base64')}`
        : `Bearer fixture_${key}`
    if (request.headers.authorization !== expected) {
      json(response, 401, {})
      return
    }
    let result,
      status = 200
    if (url.pathname.replace(/\/$/, '') === '/v1/payment_links' && request.method === 'POST') {
      if ([...links.values()].some((value) => value.reference_id === body.reference_id)) {
        json(response, 400, { error: 'duplicate reference' })
        return
      }
      if (
        body.accept_partial !== false ||
        body.notify?.email !== false ||
        body.notify?.sms !== false ||
        body.reminder_enable !== false ||
        body.customer ||
        body.callback_method !== 'get'
      ) {
        json(response, 400, { error: 'unexpected provider data' })
        return
      }
      const id = opaque('plink')
      result = {
        ...body,
        id,
        short_url: `https://rzp.io/i/${id.slice(6)}`,
        status: 'created',
        amount_paid: 0,
        payments: null,
        order_id: opaque('order'),
      }
      links.set(id, result)
    } else if (url.pathname === '/v1/payment_links') {
      result = {
        payment_links: [...links.values()].filter((value) =>
          url.searchParams.has('reference_id')
            ? value.reference_id === url.searchParams.get('reference_id')
            : value.payments?.some((p) => p.payment_id === url.searchParams.get('payment_id')),
        ),
      }
    } else if (url.pathname.startsWith('/v1/payment_links/'))
      result = links.get(url.pathname.split('/').at(-1))
    else if (url.pathname.startsWith('/v1/payments/'))
      result = payments.get(url.pathname.split('/').at(-1))
    else if (url.pathname === '/v1/disputes') {
      const skip = Number(url.searchParams.get('skip') ?? 0),
        count = Number(url.searchParams.get('count') ?? 20)
      result = {
        items: [...disputes.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(skip, skip + count),
      }
    } else if (url.pathname.startsWith('/v1/disputes/'))
      result = disputes.get(url.pathname.split('/').at(-1))
    else if (/^\/v2\/projects\/[^/]+\/purchases$/.test(url.pathname))
      result = {
        items: [...purchases.values()].filter(
          (p) => p.store_purchase_identifier === url.searchParams.get('store_purchase_identifier'),
        ),
        next_page: null,
      }
    else if (/^\/v2\/projects\/[^/]+\/purchases\//.test(url.pathname))
      result = purchases.get(decodeURIComponent(url.pathname.split('/').at(-1)))
    else if (/^\/v2\/projects\/[^/]+\/customers\/[^/]+\/purchases$/.test(url.pathname)) {
      const principal = url.pathname.split('/').at(-2),
        after = url.searchParams.get('starting_after'),
        all = [...purchases.values()]
          .filter(
            (p) =>
              p.customer_id === principal && p.environment === url.searchParams.get('environment'),
          )
          .sort((a, b) => a.id.localeCompare(b.id)),
        offset = after ? all.findIndex((p) => p.id === after) + 1 : 0,
        items = all.slice(offset, offset + Number(url.searchParams.get('limit') ?? 20))
      result = {
        items: items.map((p) => ({ id: p.id })),
        next_page:
          offset + Number(url.searchParams.get('limit') ?? 20) < all.length
            ? url.pathname + '?starting_after=' + items.at(-1).id
            : null,
      }
    }
    if (result === undefined) {
      result = { error: 'not found' }
      status = 404
    }
    // Capture a snapshot before delay to exercise genuinely stale provider observations.
    result = structuredClone(result)
    const behavior = controls.get(url.pathname)
    if (behavior?.delay) await new Promise((resolve) => setTimeout(resolve, behavior.delay))
    if (behavior?.drop) {
      controls.delete(url.pathname)
      response.destroy()
      return
    }
    json(response, status, result)
  } catch {
    if (!response.headersSent) json(response, 400, { error: 'invalid fixture request' })
    else response.destroy()
  }
}).listen(8788, '0.0.0.0')
