# Android and Swift dependency provenance

The offline report resolves both actual app `releaseRuntimeClasspath` and `debugRuntimeClasspath` from the final native measurement checkout. Each has 127 components: 115 external Maven modules and 12 application/plugin projects, with no unresolved graph edges. The two artifact views contain 110 references each, deduplicated into 104 exact binary files; eleven modules are metadata/platform components without a resolved binary. All resolved external runtime coordinates match the committed Gradle lockfile.

`android-inventory.json` maps every module to its exact cached POM, declared license metadata, SHA-256 of each resolved AAR/JAR, and any embedded license/notice text. Three modules inherit their declarations from cached parent POMs; that chain and each parent hash are recorded. All 115 modules have POM license declaration evidence. Eighteen modules have embedded upstream notice text copied from their resolved binary, including nested `classes.jar` entries. The remaining modules explicitly say that upstream notice text was unavailable in this local artifact/cache inspection. A POM declaration does not stand in for missing copyright or NOTICE text. This is an evidence inventory, not legal approval.

`android-resolved-graph.json` retains selected components, requested-to-selected edges and exact artifacts for both configurations. Machine-specific cache paths are represented by `GRADLE_MODULE_CACHE`. `android-gradle.lockfile.txt` records the exact input. The 139 lock entries that occur only in build/test configurations are listed separately from the app runtime dependencies. App/plugin project components map to the existing direct npm package inventory and notices; the generated Cordova adapter and application source are identified separately. Resolution precedes APK shrinking/packaging, so the inventory does not claim every resolved component contributes bytes to every final APK.

`spm-inventory.json` maps all eight `Package.resolved` identities, versions, repository locations and revisions to the already copied `spm-*.txt` notices. Every actual checkout HEAD equals its pinned revision. Notice hashes are checked against source checkout files. The SQLCipher notice has prior formatting changes to trailing line whitespace; both source and copied hashes and that exact comparison rule are recorded. No license text meaning is substituted or inferred.

The report used Gradle 8.14.3 with the project JDK 21 and `--offline`; no build task, dependency-lock update, global installation or network download was requested. The first legacy artifact query was rejected by Gradle's project-variant ambiguity; the final task uses an external-module artifact view while retaining project components in the graph. Only the report's newly started daemon was stopped afterward.

To reproduce in a built checkout, create a private `.gstack` output directory, set `JAVA_HOME`, `ANDROID_HOME` and an absolute `LOOPMARK_INVENTORY_OUTPUT`, then run:

```sh
./gradlew --offline --console=plain --no-configuration-cache \
  -I /path/to/scripts/licenses/android-runtime.init.gradle loopmarkRuntimeInventory
python3 scripts/licenses/native-inventory.py \
  --resolved /path/to/.gstack/android-runtime-resolved.json \
  --native-root /path/to/native-checkout \
  --existing-notices /path/to/docs/evidence/expansion/native/licenses \
  --output /path/to/inventory-output
```

The generator refuses missing/ambiguous POM evidence, unresolved edges, coordinates absent from the frozen runtime lock, unmapped plugin projects, changed SPM revisions, and unmatched copied SPM notices. It reads resolved binaries and cached POMs, and writes only inventory artifacts to the explicit output directory.
