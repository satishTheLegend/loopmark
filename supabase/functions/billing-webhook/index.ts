import { z } from 'npm:zod@4.6.7'
import { transportEndpoint, rpc } from '../_shared/command.ts'
import { rawBody } from '../_shared/raw-body.ts'
import { billing } from '../_shared/billing.ts'
import { constantEqual, hmac } from '../_shared/providers/http.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
const id = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/)
Deno.serve(
  transportEndpoint(async (request) => {
    const route = new URL(request.url).pathname.split('/').at(-1)
    if (route !== 'razorpay' && route !== 'revenuecat') throw new DomainError('NOT_AVAILABLE')
    const admin = billing(route),
      raw = await rawBody(request)
    let eventId: string, payload: Record<string, string | null>
    if (route === 'razorpay') {
      if (
        !constantEqual(
          request.headers.get('x-razorpay-signature') ?? '',
          await hmac(admin.config.secrets.razorpayWebhook!.reveal(), raw),
        )
      )
        throw new DomainError('AUTH_REQUIRED')
      eventId = id.parse(request.headers.get('x-razorpay-event-id'))
      const data = z
        .object({ event: id, payload: z.record(z.string(), z.unknown()) })
        .parse(JSON.parse(raw))
      const entities = z
        .object({
          payment: z
            .object({ entity: z.object({ id: z.string().regex(/^pay_[A-Za-z0-9]{1,100}$/) }) })
            .optional(),
          refund: z
            .object({
              entity: z.object({ payment_id: z.string().regex(/^pay_[A-Za-z0-9]{1,100}$/) }),
            })
            .optional(),
          dispute: z
            .object({
              entity: z.object({
                id: z.string().regex(/^disp_[A-Za-z0-9]{1,100}$/),
                payment_id: z.string().regex(/^pay_[A-Za-z0-9]{1,100}$/),
              }),
            })
            .optional(),
        })
        .parse(data.payload)
      payload = {
        type: data.event,
        purchaseId:
          entities.payment?.entity.id ??
          entities.refund?.entity.payment_id ??
          entities.dispute?.entity.payment_id ??
          null,
        disputeId: entities.dispute?.entity.id ?? null,
      }
    } else {
      if (
        !constantEqual(
          request.headers.get('authorization') ?? '',
          admin.config.secrets.revenueCatWebhook!.reveal(),
        )
      )
        throw new DomainError('AUTH_REQUIRED')
      const data = z
        .object({
          event: z.object({
            id,
            type: id,
            environment: z.enum(['SANDBOX', 'PRODUCTION']),
            original_app_user_id: z.string().uuid(),
          }),
        })
        .parse(JSON.parse(raw))
      if (data.event.environment.toLowerCase() !== admin.config.paymentEnvironment)
        throw new DomainError('NOT_AVAILABLE')
      eventId = data.event.id
      payload = { type: data.event.type, principalId: data.event.original_app_user_id }
    }
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')
    return await rpc(admin.client, 'loopmark_billing_webhook', {
      p_provider: route,
      p_environment: admin.config.paymentEnvironment,
      p_event: eventId,
      p_hash: hash,
      p_payload: payload,
    })
  }, false),
)
