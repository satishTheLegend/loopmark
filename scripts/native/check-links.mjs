import assert from 'node:assert/strict'
import { renderLinks } from './links.mjs'
const id = 'app.loopmark.craft'
const fixture = {
  appOrigin: 'https://fixture.invalid',
  appleApplicationIdentifier: `ABCDE12345.${id}`,
  androidSha256: [Array(32).fill('AB').join(':')],
}
const files = renderLinks(fixture, id)
assert.equal(
  JSON.parse(files.aasa).applinks.details[0].appIDs[0],
  fixture.appleApplicationIdentifier,
)
assert.equal(JSON.parse(files.assetlinks)[0].target.package_name, id)
assert.match(files.intent, /android:autoVerify="true"/)
assert.match(files.entitlements, /applinks:fixture.invalid/)
assert.deepEqual(
  JSON.parse(files.aasa).applinks.details[0].components.map((item) => item['/']),
  ['/p/*', '/auth/callback'],
)
for (const appOrigin of [
  'http://fixture.invalid',
  'https://fixture.invalid/',
  'https://fixture.invalid:443',
  'https://fixture.invalid:444',
  'https://fixture.invalid/path',
  'https://fixture.invalid?q=1',
  'https://fixture.invalid#project=x',
  'https://user@fixture.invalid',
  'https://*.fixture.invalid',
  'https://localhost',
])
  assert.throws(() => renderLinks({ ...fixture, appOrigin }, id))
assert.throws(() =>
  renderLinks({ ...fixture, appleApplicationIdentifier: 'ABCDE12345.other.app.id' }, id),
)
assert.throws(() => renderLinks({ ...fixture, androidSha256: ['invalid'] }, id))
assert.throws(() =>
  renderLinks(
    { ...fixture, androidSha256: [fixture.androidSha256[0], fixture.androidSha256[0]] },
    id,
  ),
)
process.stdout.write(
  'PASS: exact signed-link output and invalid origin/identity/certificate rejection. No domain configured.\n',
)
