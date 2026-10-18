# Unsigned native contributor path

Guest native capture needs no cloud account or payment configuration. Complete the [guest setup](quickstart.md) first. Use the committed iOS/Android projects and project-pinned Capacitor packages. Never run a global package upgrade to repair a local build.

## iOS simulator on macOS

Install and select a compatible Xcode toolchain and an iOS simulator runtime. The project uses Swift Package Manager; first resolution may download dependencies. Run:

```sh
npm run doctor -- --capability native-ios --json
npm run native:sync
npm run native:ios:build
```

The normal build uses `CODE_SIGNING_ALLOWED=NO` and produces a simulator Debug app. Open the committed Xcode project to install/run on a test-owned simulator. Device signing, entitlements, App Store Connect and store review are separate external prerequisites. A simulator build is not evidence that physical camera/microphone permissions work.

## Android emulator

Install Java 21, Android platform/build tools for API 36, and an emulator image. Set `LOOPMARK_JAVA_HOME` (or `JAVA_HOME`) and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to their actual locations. Review/accept SDK licenses yourself; scripts do not change global settings or accept them for you.

```sh
npm run doctor -- --capability native-android --json
npm run native:sync
npm run native:android:build
```

The build produces an ordinary debug APK in the Android app build output. Install it on an authorized emulator from Android Studio. First Gradle resolution may download dependencies. An unavailable Java/SDK fails explicitly. Production signing/keystore ownership, Play Console products and store release are separate.

## Meaningful native check

Create a synthetic project, record a next step and a photo/audio fixture, background and force-stop the app, reopen it, then export and restore. The photo/audio must still open and appear in the complete portable backup. A missing attachment must remain visibly missing; no partial export may claim completion. Text-only drafts must also survive restart.

For repeatable bridge assertions, use a disposable test-owned simulator/emulator. The harness installs synthetic assets into the app with the same application ID; do not run it over personal craft data. Build the harness explicitly:

```sh
LOOPMARK_NATIVE_TEST_BUILD=1 node scripts/native/harness.mjs
LOOPMARK_NATIVE_TEST_BUILD=1 node scripts/native/build-ios.mjs
```

Set `LOOPMARK_IOS_SIMULATOR` to that simulator's UUID and run `npm run test:native:ios`. For Android, run `npm run native:android:build`, set `ANDROID_SERIAL` to the authorized `emulator-...` serial and run `npm run test:native:android`. The runners launch twice to check process persistence and emit runtime evidence; absent targets are errors. Run `npm run native:sync` afterward to restore production assets before any normal product build or release.

Native credentials use secure platform storage. SQLite stores craft metadata; platform files store media. Native export/share uses file references, not an unbounded bridge-wide base64 string. The [dependency/license inventory](../evidence/expansion/native/licenses/inventory.json) records exact selected native package versions and notices. It explicitly does not yet claim a complete Android transitive distribution inventory. SQLCipher is linked despite an unencrypted local DB, and the unmodified recorder dependency has MPL-2.0 obligations. Review notices and store encryption disclosures before distribution; this project adds no new license grant.
