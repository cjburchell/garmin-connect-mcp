# Troubleshooting

| Symptom | Action |
|---|---|
| Health says `garminConfigured: false` | Create a Garmin Personal API key and run the hidden local configuration prompt. This is expected before account setup. |
| Live access disabled | Obtain explicit authorization, then set `GARMIN_ALLOW_NETWORK=true` in `.env` and recreate/restart the adapter. |
| Garmin 401/403 | Key may be wrong, expired or revoked, or the requested record is not your own. Generate a new Personal API key. Do not use your Garmin account password. |
| HTTP 401 | Configure the client's bearer header using `MCP_AUTH_TOKEN` from the local `.env`; do not use the Garmin key here. |
| HTTP 403 | Host/Origin must match loopback and port. Remote browser origins are intentionally blocked. |
| HTTP 413 | Request exceeds 64 KiB. Reduce the payload. |
| JSON response too large | Query fewer activities/days. JSON responses are limited to 1 MiB; inline downloads to 3 MiB. |
| Training totals are partial | Narrow the date range; the adapter stops at 500 activities or its page-start time budget. |
| Recovery data missing | 204 means no data; empty payloads/missing fields also indicate unavailable data. Device support and wearing/logging affect availability. Recovery time/training readiness are unsupported by the documented Personal API. |
| Rate limited / timeout / 5xx | Wait and retry a smaller query. Per-request timeout is 12s; no automatic rate-limit retry loop. |
| Port in use | Stop the other instance. Docker publishes localhost:8091; native and Docker should not run together on the same port. |
| Docker does not start after reboot | Enable Docker Desktop startup at sign-in. `unless-stopped` starts the container when Docker starts, except deliberately stopped containers. |
| `npm.ps1` blocked | Use `npm.cmd`, not a system-wide execution-policy change. For the reviewed setup script, use the per-process PowerShell command in README. |
| Tunnel not listed | Check organization/workspace association, permissions, account entitlement and client polling. See chatgpt-integration.md. |

Useful local checks (do not print `docker inspect` environment or `docker compose config` without `--quiet`, as these can reveal secrets):

```powershell
cd E:\dev\Garmin-MCP
docker compose ps
docker compose logs --tail 30
curl.exe http://127.0.0.1:8091/health
docker compose up -d --force-recreate
```

For native mode, restart `npm.cmd run start:http` after editing `.env`. The health endpoint checks local process/configuration only; it never calls Garmin and is not evidence of successful account authentication.

Secrets are excluded by `.gitignore` and `.dockerignore`. Before sharing diagnostics, remove tokens and personal data. Use `git check-ignore .env` to confirm exclusion. Rotate any key/token accidentally disclosed. The adapter makes on-demand queries, so it has no synchronized database or persistent personal data volume to recover after a restart.
