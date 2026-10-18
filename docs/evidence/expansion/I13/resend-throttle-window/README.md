# Resend throttle fixture window

The original Firefox failure expected HTTP 429 but received HTTP 200. Its real OTP requests began at 2.836s and 10.631s: 7.795 seconds apart. The configured local Auth resend interval is five seconds. Reload alone took 4.690 seconds, then filling the email and clicking Send consumed more time. The initial disabled-resend assertion passed. The server did not bypass its throttle; the fixture had already left the throttle window.

[The sanitized trace extraction](original-trace-proof.json) binds this finding to the frozen source and original trace SHA256. It contains no OTPs, emails, tokens or request bodies.

## Controlled fixture

The initial delivered code, disabled resend control, reload, and second UI send remain. Just before forwarding that second real POST, the fixture uses the existing local Docker/profile checks and a stricter generated UUID email guard. It atomically updates only that user's last-send markers and requires exactly one matched row. The markers are set to current database time and the request continues immediately. No future timestamp or global Auth policy change is used.

The request continues to the real Auth endpoint. No response is mocked. The existing HTTP 429, `RATE_LIMITED`, disabled “Try again in” control, and absent account identity assertions remain unchanged. The existing expiry test shares the guarded helper; its timestamp-aging SQL and HTTP/UI assertions remain unchanged.

Real API priming would require another email request and still depend on the same dispatch window. Setting the per-user server timestamp at the already-held request removes reload and typing from the interval. Host scheduling could still consume the five-second window. The fixture therefore records the returned database marker/observation times, local monotonic SQL/response bounds, browser request timings and actual status in a safe attachment. A non-429 without a proven in-window observation fails as an expired or unproven fixture precondition. It never silently passes, retries, or changes the HTTP429/UI oracle. This verifies handling of real throttled state after reload, not exact server latency at the boundary.

## Verification

Prettier and `git diff --check` pass. No browser, build, service or SQL command was executed during preparation. Runtime verification is pending root coordination: both Auth error journeys across five profiles (10 cases), including the original Firefox resend failure. Product source remains frozen.
