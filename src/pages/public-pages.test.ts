import { describe, expect, it } from 'vitest'
import { parsePublicConfig } from '../config'
import { publicPath, publicPaths, renderPublicPage, supportContact } from './public-pages'

describe('public pages boundary', () => {
  it('serves only fixed public paths and leaves app, account and receipt routes private', () => {
    for (const path of publicPaths) {
      expect(publicPath(path)).toBe(path)
      expect(publicPath(`${path}/`)).toBe(path)
      expect(publicPath(`${path}/index.html`)).toBe(path)
    }
    for (const path of ['/', '/account', '/deletion-status', '/privacy/project', '/auth/callback'])
      expect(publicPath(path)).toBeUndefined()
  })

  it('does not announce cloud storage for an unconfigured guest build', () => {
    const html = renderPublicPage('/privacy', { config: parsePublicConfig({}) })
    expect(html).toContain('Account connection and cloud storage are not enabled here.')
    expect(html).toContain('No craft content is uploaded in guest mode.')
    expect(html).not.toContain('Supabase provides')
    expect(html).toContain('noindex, nofollow')
    expect(html).not.toContain('rel="canonical"')
  })

  it('describes optional connected mode without exposing keys in public HTML', () => {
    const config = parsePublicConfig({
      VITE_LOOPMARK_APP_ORIGIN: 'https://loopmark.example',
      VITE_LOOPMARK_SUPABASE_URL: 'https://backend.example',
      VITE_LOOPMARK_SUPABASE_ANON_KEY: 'sb_publishable_SYNTHETIC_PUBLIC_KEY_0123456',
    })
    for (const path of publicPaths) {
      const html = renderPublicPage(path, { config })
      expect(html).toContain(`rel="canonical" href="https://loopmark.example${path}"`)
      expect(html).not.toContain('SYNTHETIC_PUBLIC_KEY')
      expect(html).not.toContain('backend.example')
      expect(html).not.toContain('<script')
    }
    expect(renderPublicPage('/privacy', { config })).toContain('not end-to-end encrypted')
  })

  it('rejects contact header/HTML injection without echoing supplied content', () => {
    for (const value of [
      'x@example.test?bcc=secret@example.test',
      'x@example.test\r\nBcc: secret',
      '<script>private</script>',
    ]) {
      let message = ''
      try {
        supportContact(value)
      } catch (error) {
        message = String(error)
      }
      expect(message).toContain('valid plain email address')
      expect(message).not.toContain(value)
    }
    const html = renderPublicPage('/support', {
      config: parsePublicConfig({}),
      supportEmail: 'maker+help@example.test',
    })
    expect(html).toContain('mailto:maker%2Bhelp@example.test')
  })
})
