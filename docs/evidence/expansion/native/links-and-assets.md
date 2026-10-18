# Native link and brand setup

The development app identifier is `app.loopmark.craft`. No public domain, Apple team/app-ID prefix, release certificate, associated-domain capability or hosted association file has been supplied. The checked-in shells claim no web domain. The empty iOS entitlement file is intentional; simulator QA overrides it with a separate local Keychain fixture.

`scripts/native/links.mjs` prepares exact HTTPS Universal Link/App Link files from operator-owned configuration. It validates the current Capacitor app ID, an Apple application identifier with the matching bundle suffix, and one to four distinct uppercase SHA-256 certificate fingerprints. It accepts no wildcard, alternate scheme, URL credentials, port, query or path. Routes are limited to `/p/*` and `/auth/callback`; runtime parsing still validates origin, route, selected collection and account. Legacy root-fragment labels remain browser links because fragments are not a reliable OS association path boundary.

The configuration JSON fields are `appOrigin`, `appleApplicationIdentifier`, and `androidSha256` (an array). Obtain the Apple application identifier from the actual signed application's entitlements; its prefix is usually the team ID but must not be guessed. Obtain Android fingerprints from the release signing certificate, including the Play App Signing certificate when applicable. These are public association identifiers, not credentials.

```sh
node scripts/native/links.mjs /path/to/operator-owned-links.json ./native-link-artifacts
node scripts/native/check-links.mjs
```

The output directory must not already exist. Preparation emits `.well-known/apple-app-site-association`, `.well-known/assetlinks.json`, `App.entitlements`, and `android-intent-filter.xml`. Review these artifacts first. A separate invocation with a new output directory and `--apply` updates only the marked Android intent-filter block and `ios/App/App/App.entitlements`. It does not publish, sign, configure accounts or contact a provider. Set the same exact origin in the app's public configuration, configure the signing capability, and host the two association files with JSON content type on the owned HTTPS domain. Rebuild after applying. A successful local render or build does not prove OS domain verification.

Qualification after operator setup must cover cold/warm launches, callback replay/expiry, project links while signed out, another account's label, missing local records and revoked access. Use Android `pm verify-app-links --re-verify app.loopmark.craft` and inspect `pm get-app-links`; on Apple follow the associated-domain diagnostics on the signed device. No such signed or hosted result is claimed here.

Primary references checked 18 October 2026: [Apple associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains), [Apple entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.associated-domains), [Android association configuration](https://developer.android.com/training/app-links/configure-assetlinks), [Android link verification](https://developer.android.com/training/app-links/verify-applinks).

`node scripts/native/assets.mjs` regenerates 30 native PNG assets from the existing `public/icon.svg` brand mark through local Chromium canvas rendering. It preserves existing target dimensions, creates opaque iOS icon/splash images, circular legacy Android icons, and a transparent Android adaptive foreground within the mark's safe region. All browser network requests are blocked. Tabler remains the interface icon library; the established Loopmark brand mark is reused for application identity. No new icon library, AI image, remote image service or visual identity was introduced.
