# Native cache repair, examples and decoding profile

Source c471bc66b89b16fd63bc90485ce79cc6ed94a96c was bundled and installed into the separate benchmark application. The manifest and every report include the source, asset manifest and installed artifact hashes. Both Xcode simulator and Android debug builds succeeded.

Actual iOS and Android SQLite/files runs passed six cache repair/export checks and all four executable repository examples. Network replies in the complete-export and lost-reply example are explicitly synthetic; local storage, native file publication, decoding and production service paths are real. No provider or physical-device qualification is claimed.

The shared-load decoding profile compares identical 6 MiB payloads in the same runtime. iOS legacy string iteration took 128–279 ms versus 33–46 ms for the preallocated byte loop; Android took 542–2478 ms versus 27.5–121.3 ms. Every decoded byte was checked. These isolate the identified allocation hotspot; they are not end-to-end throughput or release capacity promises. The optimized 48 MiB import/export measurements remain a separately coordinated gate.
