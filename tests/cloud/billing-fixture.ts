import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseOperatorConfig } from '../../scripts/lib/config.mjs'
const execute = promisify(execFile)

/** Synthetic local provider control only; the real app still verifies through Auth/Edge/SQL. */
export async function capturedReturn(attemptId: string) {
  if (!/^[a-f0-9-]{36}$/.test(attemptId)) throw new Error('Invalid synthetic attempt')
  const config = parseOperatorConfig(process.env, process.cwd())
  const container = `loopmark_billing_fixture_${config.projectId}`
  try {
    const label = await execute(
      'docker',
      ['inspect', '--format', '{{index .Config.Labels "loopmark.fixture.project"}}', container],
      { timeout: 10000 },
    )
    if (label.stdout.trim() !== config.projectId) throw new Error()
    const result = await execute(
      'docker',
      [
        'exec',
        container,
        'node',
        '--input-type=module',
        '-e',
        `
      import { createHmac } from 'node:crypto';
      const attemptId=process.argv[1], key=process.env.LOOPMARK_BILLING_FIXTURE_KEY;
      const response=await fetch('http://127.0.0.1:8788/control',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({action:'payment',attemptId})});
      if(!response.ok)process.exit(2);
      const payment=await response.json();
      const signature=createHmac('sha256','fixture_'+key).update(payment.paymentLinkId+'|'+attemptId+'|paid|'+payment.paymentId).digest('hex');
      process.stdout.write(JSON.stringify({...payment,signature}));
    `,
        attemptId,
      ],
      { timeout: 15000, maxBuffer: 4096 },
    )
    const payment = JSON.parse(result.stdout) as {
      paymentId: string
      paymentLinkId: string
      signature: string
    }
    const url = new URL('/purchase/return', config.appOrigin)
    url.search = new URLSearchParams({
      razorpay_payment_id: payment.paymentId,
      razorpay_payment_link_id: payment.paymentLinkId,
      razorpay_payment_link_reference_id: attemptId,
      razorpay_payment_link_status: 'paid',
      razorpay_signature: payment.signature,
    }).toString()
    return url.href
  } catch {
    throw new Error(
      'The exact selected local billing fixture must be running; no real provider fallback is allowed.',
    )
  }
}
