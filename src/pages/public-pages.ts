import type { PublicConfig } from '../config.ts'

export const publicPaths = ['/privacy', '/support', '/delete-account'] as const
export type PublicPath = (typeof publicPaths)[number]
export interface PublicPageOptions {
  config: PublicConfig
  supportEmail?: string
}

export function publicPath(pathname: string): PublicPath | undefined {
  const clean = pathname.replace(/\/(?:index\.html)?$/, '')
  return publicPaths.find((path) => path === clean)
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  )
}

export function supportContact(value: string | undefined): string | undefined {
  if (!value) return undefined
  // A plain mailbox, never a URL or mailto header. No supplied value is echoed on failure.
  if (
    value.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
      value,
    )
  ) {
    throw new Error('The public support mailbox must be a valid plain email address.')
  }
  return value
}

const pages = {
  '/privacy': {
    title: 'Your projects, your choice',
    label: 'Privacy',
    description:
      'How Loopmark stores your craft projects, photos and voice notes on your device and in an optional account.',
  },
  '/support': {
    title: 'A little help getting back to it',
    label: 'Support',
    description:
      'Help with saving checkpoints, complete backups, account access and missing attachments in Loopmark.',
  },
  '/delete-account': {
    title: 'Leave with your work in hand',
    label: 'Delete your account',
    description:
      'Export your Loopmark projects, choose what stays on your device, and request account deletion.',
  },
} as const

function contact(email: string | undefined): string {
  return email
    ? `<p>Contact <a href="mailto:${escape(encodeURIComponent(email).replace(/%40/g, '@'))}">${escape(email)}</a>. Include the diagnostic code if one is shown. Do not send passwords, sign-in codes, payment details, deletion receipt tokens or a project backup unless you have agreed on a safe way to share it.</p>`
    : '<p>Direct support is not available from this copy of Loopmark yet. The steps on this page remain available without an account. Keep a complete backup before changing devices or clearing storage.</p>'
}

function content(path: PublicPath, options: PublicPageOptions): string {
  const cloud = options.config.cloud.enabled
  const account = cloud
    ? '<p>An account is optional. Signing in does not move your local projects automatically. Review the destination account and connection preview before uploading a collection.</p>'
    : '<p>This copy works on this device. Account connection and cloud storage are not enabled here.</p>'
  if (path === '/privacy')
    return `
    <p class="intro">Your next step, photos and voice notes can be personal. You choose whether to keep them on this device or connect a collection to an account.</p>
    <section><h2>When you work on this device</h2><p>Projects, saved checkpoints and unfinished drafts are stored locally. Photo and microphone access happens when you choose to add an attachment. Loopmark does not transcribe voice notes. No craft content is uploaded in guest mode.</p><p>Browser data can be removed by the browser or by clearing site storage. In a native app, removing the app can remove its local data. Download a complete backup before moving or clearing anything.</p></section>
    <section><h2>When you connect an account</h2>${account}${cloud ? '<p>Your account email is used for sign-in. The collection you choose to connect, including its notes and attachments, is sent to private account storage. Supabase provides authentication, the database and object storage. Access is restricted to your account; this is not end-to-end encrypted storage.</p><p>Saved on this device, synced to your account, and available offline are separate states. A photo may still need to download even when its checkpoint text is visible. Other copies you have already downloaded cannot be recalled remotely.</p>' : ''}</section>
    <section><h2>Backups and project labels</h2><p>A complete export includes saved projects, checkpoint history, photos and voice notes. Unfinished drafts are separate. Export files are not encrypted by Loopmark; store and share them carefully. A QR label is a shortcut to a record, not a backup or a public copy of your notes.</p></section>
    <section><h2>Purchases</h2><p>Where an upgrade is offered, checkout or the device store handles payment. Loopmark does not ask you to enter card details into a craft checkpoint. Razorpay handles supported web checkout; RevenueCat coordinates purchases through Apple or Google in native apps. Access is verified against the purchase provider. A refund or revoked upgrade does not hide saved history or prevent export.</p><p>Minimal purchase identifiers and verification records may need to remain after account deletion for purchase recovery, refunds and applicable recordkeeping. The service operator must disclose the retention that applies before accepting a live payment.</p></section>
    <section><h2>Deletion and control</h2><p>You can delete a local project or choose whether to keep a disconnected device copy when signing out. Deleting a connected project affects that account across devices. Account deletion disables cloud access and removes owned live records and attachments. The private deletion receipt distinguishes live-data removal from the later expiry of retained recovery backups.</p><p>A disconnected copy or an export you have kept remains under your control. See <a href="/delete-account">account deletion</a> for the steps.</p></section>
    <section><h2>Diagnostics and contact</h2><p>Loopmark does not include advertising or automatic product analytics. Hosting, authentication and payment providers may process technical logs needed to run their services. Share a diagnostic code instead of private project content when asking for help.</p>${contact(options.supportEmail)}</section>`
  if (path === '/support')
    return `
    <p class="intro">Start with the saved next step. If something interrupts you, keep the current form open until you know your work is saved.</p>
    <section id="saving"><h2>“Not saved” or device storage is full</h2><p>Do not clear site data or remove the app. Keep the draft open, free space elsewhere on the device, then retry Save checkpoint. A success message appears only after the local save completes. Use Backup &amp; restore to export saved work before making larger changes.</p></section>
    <section id="backup"><h2>Make a complete backup</h2><ol><li>Open <a href="/#backup">Backup &amp; restore</a>.</li><li>Choose the collection you want to keep and create a complete export.</li><li>Wait until all required photos and voice notes have been checked and the file is ready.</li><li>Keep the downloaded JSON file somewhere you can find from another device.</li></ol><p>If attachments are missing, reconnect and retry them. A partial download is not a complete backup. Restore previews explain what will change before you confirm. Do not delete your original file.</p></section>
    <section id="sync"><h2>A project or attachment is missing</h2><p>Check the selected collection first. A guest, connected, retained or recovered collection can contain different projects. A bag label opens the matching local or authorized account record; it does not carry your project history.</p>${cloud ? '<p>Open Account &amp; device, then Sync details. It lists conflicts, waiting items and failed attachments separately. Compare conflicting versions before choosing; a retry cannot decide which instructions you meant. A photo or voice note with a download prompt needs its own bytes before it is available offline.</p>' : account}</section>
    <section id="purchase"><h2>Upgrade or restore a purchase</h2><p>Use the same Loopmark account and device-store account used for the purchase. Open Upgrade status to check verification or Restore purchases. A pending payment is not a reason to pay again. Purchases are not transferred to another account automatically, and screenshots alone do not establish ownership.</p><p>If an upgrade is unavailable, your saved projects, history and export stay available.</p></section>
    <section id="deletion"><h2>After requesting account deletion</h2><p>Keep the deletion receipt and its private status token. It works separately from sign-in. Do not post the token or include it in an ordinary support message. If you lose it, support must verify ownership without revealing whether another person's account exists.</p></section>
    <section id="contact"><h2>Contact and diagnostics</h2>${contact(options.supportEmail)}</section>`
  return `
    <p class="intro">You can keep a complete export before closing an account. Removing cloud data and removing a copy on this device are separate choices.</p>
    <section><h2>Using Loopmark without an account</h2>${account}<p>If you have only used guest mode, there is no Loopmark account to delete. Export your saved work first. You can remove individual projects in the app, or remove all local data through your browser's site-storage settings or by removing the native app.</p></section>
    <section><h2>Request account deletion</h2><ol><li>Open <a href="/#backup">Backup &amp; restore</a> and create a complete export if you want to keep your saved work.</li><li>Open <a href="/#account">Account &amp; device</a>, then Delete account.</li><li>Confirm your account with a fresh sign-in code.</li><li>Choose whether to keep a disconnected device copy. Review unsent work, attachments and drafts before removing a device copy.</li><li>Confirm the deletion consequences and save your private receipt.</li></ol><p>If account connection is unavailable in this copy, use the copy of Loopmark where you connected your account or the support contact below.</p></section>
    <section><h2>What happens next</h2><p>Cloud access is disabled while live account records and owned photos and voice notes are removed. The receipt reports progress. “Live data removed” is separate from completion: recovery backups may remain until the expiry shown on the receipt.</p><p>Minimal payment and recovery records may remain for purchase recovery, refunds and applicable recordkeeping. Deletion does not erase exports or disconnected copies you already kept, and those copies cannot be recalled from another device.</p></section>
    <section><h2>Without access to the app</h2>${options.supportEmail ? '<p>Contact support to request account deletion or recover access. Ownership must be verified before changes are made. Do not send a sign-in code or password by email.</p>' : '<p>This copy does not yet provide a remote deletion-request contact. An active service must provide one before public account enrollment. Guest data can still be removed directly from your own device.</p>'}${contact(options.supportEmail)}</section>`
}

export function renderPublicPage(path: PublicPath, options: PublicPageOptions): string {
  const page = pages[path]
  const origin = options.config.appOrigin
  const indexable = !!origin && new URL(origin).protocol === 'https:'
  const email = supportContact(options.supportEmail)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f8f5ef"><meta name="referrer" content="no-referrer"><meta name="description" content="${escape(page.description)}"><meta name="robots" content="${indexable ? 'index, follow' : 'noindex, nofollow'}">${indexable ? `<link rel="canonical" href="${escape(origin + path)}">` : ''}<link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/public-pages.css"><title>${escape(page.label)} · Loopmark</title></head>
<body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="/"><img src="/icon.svg" width="36" height="36" alt="">loopmark<span>.</span></a><a class="open-app" href="/">Open your projects</a></header><main id="main"><p class="eyebrow">${escape(page.label)}</p><h1>${escape(page.title)}</h1>${content(path, { ...options, supportEmail: email })}</main><footer><nav aria-label="Help and privacy">${publicPaths.map((item) => `<a href="${item}"${item === path ? ' aria-current="page"' : ''}>${pages[item].label}</a>`).join('')}</nav><p>Keep a little note for your future self.</p></footer></body></html>`
}
