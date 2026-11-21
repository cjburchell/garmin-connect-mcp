# Architecture and selection

Evaluated 2026-11-20. Selected upstream: https://github.com/pedrokehl/garmin-connect-mcp, baseline `b90f0c2`. Personal fork: https://github.com/cjburchell/garmin-connect-mcp. Local work: `E:\dev\Garmin-MCP`.

| Question | Finding |
|---|---|
| Maintenance | Recent commits on 2026-10-23 and an existing 175-test suite. Active recently, but version 0.1.0 and a short history offer no long-term maintenance guarantee. |
| API | Official Garmin Connect Personal API. No web password login, MFA workarounds, TLS impersonation or scraping. |
| Windows | Node implementation is portable. This fork adds and tests a native Node HTTP host; an upstream test had a path-separator assumption, now corrected. |
| Transport | Official MCP TypeScript SDK v2 Streamable HTTP handler, plus upstream stdio. |
| Continuous operation | Native foreground Node process; Docker Compose adds restart behavior and health monitoring. No service installer was required. |
| Read-only | Data requests are GETs; the sole POST exchanges the Personal API key for an access token. All tools advertise read-only/non-destructive annotations. |
| License | MIT permits modification and local use; the original license and attribution are retained. |
| Security | Key exchange and in-memory token caching; HTTP bearer or upstream OAuth gate. Dependencies are the official MCP server SDK and Zod, with no Garmin login library. `npm ci --ignore-scripts` avoids dependency install hooks. Local audit returned zero known vulnerabilities, which is not a comprehensive security audit. |

A new C# server would duplicate 26 endpoint mappings, token exchange, validation and transport/OAuth handling. Reusing this TypeScript implementation has the lower immediate maintenance burden, despite the user's C# preference. There is no reason to introduce a replacement adapter.

## Data flow

Local MCP client -> loopback HTTP adapter -> upstream MCP auth/validation -> cached Garmin token -> official Personal API. Optional future OpenAI Secure MCP Tunnel initiates outbound connections and forwards authorized MCP requests locally. No public listener or tunnel for Garmin was created.

Node host binds `127.0.0.1` by default. Docker binds inside its container and publishes only `127.0.0.1:8091` on Windows. Host and Origin checks reject foreign browser origins and DNS rebinding. HTTP requests are capped at 64 KiB. JSON API bodies are stream-capped at 1 MiB; binary inline downloads retain the upstream 3 MiB cap. Existing per-Garmin-request timeout is 12 seconds, with one token-refresh retry after 401. Requests do not automatically retry 429 or server errors.

`garmin_get_training_summary` reuses the activity-list API: at most five 100-item pages and 366 calendar days, with a 60-second check before starting another page. An individual page may extend this budget through its request timeout/refresh; partial totals are labeled. Weeks begin Monday in the activity's local calendar. Durations are seconds; distances/elevations meters. Missing metric sums return null plus coverage counts; heart-rate averages are unweighted means of available activity averages. Duplicate activity IDs are removed. Exact date and parent-type filters are sent to Garmin; local dates are additionally checked before aggregation. Existing recovery tools preserve Garmin's raw fields rather than inventing a new schema.

## Secrets and operating boundaries

`.env` is Git-ignored, omitted from Docker build context, and restricted to the current Windows user and SYSTEM by `scripts/configure-local.ps1`. It remains plaintext on disk; full-disk protection and local administrator access are outside the adapter. Environment secrets are visible to processes with sufficient rights and Docker administrators. Access tokens are memory-only and lost at restart. No Garmin data cache is required because requests query Garmin on demand.

The local host blocks external Garmin calls until `GARMIN_ALLOW_NETWORK=true`, requires a configured key, allows only the official HTTPS origin, and rejects redirects. Live API error bodies are discarded to avoid returning echoed credentials. Diagnostics contain status/duration, not headers, URLs, parameters, passwords, tokens or health data. Upstream stdio/deployment scripts are retained for compatibility but do not use the new local host's explicit network gate; use the documented local HTTP/Docker entrypoints.

No firewall rules, public deployment, Garmin account integrations, tunnel registrations or paid services were created. Live authentication and account-specific metric availability remain unverified until authorized.

## Primary references

- [Garmin Personal API and key/token setup](https://developer.garmin.com/gc-developer-program/personal/personal-api/)
- [Garmin Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
- [Garmin API reference](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
- [Official Garmin reference client](https://github.com/garmin/connect-personal-api-python)
- [Upstream server and MIT license](https://github.com/pedrokehl/garmin-connect-mcp)
- [OpenAI MCP transport requirements](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [OpenAI private tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
