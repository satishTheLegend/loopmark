import { test, expect } from '@playwright/test'

test('the next stitch and tool precede secondary file administration on desktop and narrow screens', async ({
  page,
}) => {
  await page.goto('/tests/ui/project-detail.html')
  const next = page.getByRole('region', { name: 'Latest checkpoint' })
  await expect(next).toContainText('Turn and knit the first stitch.')
  await expect(next).toContainText('4 mm needles')
  await expect(page.getByRole('button', { name: 'Save a checkpoint', exact: true })).toBeVisible()
  expect(
    await next.evaluate((element) =>
      Boolean(
        element.compareDocumentPosition(document.querySelector('[aria-label="Project files"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
  ).toBe(true)
  expect((await next.boundingBox())!.y).toBeLessThan(
    (await page.getByRole('region', { name: 'Project files' }).boundingBox())!.y,
  )
})

for (const [failure, code] of [
  ['auth', 'AUTH_REQUIRED'],
  ['storage', 'LOCAL_STORAGE_FAILED'],
  ['raw', 'UNEXPECTED'],
]) {
  test(`individual attachment failure ${failure} retains its trusted remedy and readable checkpoint`, async ({
    page,
  }) => {
    await page.goto(`/tests/ui/project-detail.html?failure=${failure}`)
    await page.getByRole('button', { name: 'Download photo', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Your checkpoint text is still here.')
    await expect(page.getByRole('alert')).toContainText(`Diagnostic code: ${code}`)
    await expect(page.getByRole('alert')).not.toContainText('private-provider-token-and-craft-text')
    await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
      'Turn and knit the first stitch.',
    )
    await expect(page.getByRole('button', { name: 'Download photo', exact: true })).toBeEnabled()
  })
}
