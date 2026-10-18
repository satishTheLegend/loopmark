import { expect, type Page } from '@playwright/test'
import { parseOperatorConfig } from '../../scripts/lib/config.mjs'
const config = parseOperatorConfig(process.env, process.cwd())
export const origin = config.appOrigin
const mail = `http://127.0.0.1:${config.ports.mail}`
export async function deliveredCode(email: string, send: () => Promise<unknown>) {
  const before = await (await fetch(mail + '/api/v1/messages')).json()
  const previous = new Set(before.messages.map((message: { ID: string }) => message.ID))
  await send()
  let code = ''
  await expect
    .poll(
      async () => {
        const inbox = await (await fetch(mail + '/api/v1/messages')).json()
        const message = inbox.messages.find(
          (item: { ID: string; To: Array<{ Address: string }> }) =>
            !previous.has(item.ID) && item.To.some((to) => to.Address === email),
        )
        if (!message) return false
        const value = await (await fetch(mail + '/api/v1/message/' + message.ID)).json()
        code = String(value.Text).match(/\b\d{6}\b/)?.[0] ?? ''
        return !!code
      },
      { timeout: 15_000, intervals: [250, 500, 1000] },
    )
    .toBe(true)
  return code
}
export async function signIn(page: Page, email: string) {
  await page.goto(origin + '/#account')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(email)
  const code = await deliveredCode(email, () =>
    page.getByRole('button', { name: 'Send sign-in code' }).click(),
  )
  await page.getByLabel('Sign-in code', { exact: true }).fill(code)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('.account-identity')).toContainText(email)
}
export async function chooseAccount(page: Page) {
  await page.getByRole('button', { name: 'Change collection' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Account projects/ })
    .click()
  await expect(page.locator('.collection-heading')).toContainText('Account projects')
  await expect(page.getByText('Opening your account collection…')).toHaveCount(0)
}
export async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
}
