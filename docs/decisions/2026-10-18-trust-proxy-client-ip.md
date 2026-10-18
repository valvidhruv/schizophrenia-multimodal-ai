# Trust Proxy Configuration for Client IP Resolution

- **Date**: 2026-10-18
- **Status**: Accepted
- **Scope**: `backend/src/config/index.ts`, `backend/src/app.ts`,
  `.env.example`

## Context

The Phase 1C security review rated the missing `trust proxy` setting as a
high-severity issue in any reverse-proxied deployment:

- With Express' default (`trust proxy` disabled), `req.ip` is the socket
  address, so behind nginx every request resolves to the proxy's address.
  Audit records would then log the proxy IP instead of the client, and the
  global rate limiter (keyed on `req.ip`) would count all clients into one
  shared bucket - one noisy client could lock out everyone.
- Naively enabling trust-all (`TRUST_PROXY=true`) or a hop count larger than
  the real proxy chain makes `X-Forwarded-For` attacker-controlled, turning
  audit IPs and rate-limit keys into spoofed values.

Topology evidence in this repository: `docker/nginx.frontend.conf` is a single
nginx hop that appends the real client address to `X-Forwarded-For`
(`$proxy_add_x_forwarded_for`); `docker-compose.yml` currently publishes the
backend directly on `3001` with the nginx service commented out, so local
development reaches the backend with no proxy at all. Production topology is
not encoded anywhere in the repository, so the correct value is an operator
decision and cannot be defaulted beyond "disabled".

## Decision: explicit, fail-fast `TRUST_PROXY` parsing

`TRUST_PROXY` is optional; blank/whitespace/`0` disables trust (the safe
default for direct access and local development). Accepted forms:

1. **Hop count `1`-`10`** - for deployments with a fixed number of proxies.
   The count must equal the real chain exactly (e.g. `1` for one nginx).
2. **Comma-separated IPv4 addresses/CIDR ranges** (prefix 1-32) - trust only
   specific proxy addresses.

Rejected with a `ConfigError` naming `TRUST_PROXY`: trust-all values
(`true`, `yes`, `on`, `all`, `*`), hop counts above 10, mixed hop
count/address forms, empty entries, IPv4 with leading zeros or octets above
255, prefix `0` or above `32`, and any IPv6 entry (use a hop count instead,
which is value-agnostic). `docker-compose.yml` and nginx configuration are
untouched; enforcement depends on operator configuration, documented in
`.env.example`.

`app.set('trust proxy', config.trustProxy)` runs immediately after
`express()` in `createApp`, before any middleware, so `req.ip` is consistent
for rate limiting and audit recording. Express compiles the setting eagerly
in `app.set`, and config validation guarantees only supported forms ever reach
it.

## Operational requirements

- **When `TRUST_PROXY` is set, the backend port must not be reachable by
  clients directly** - only the proxy may connect to it. Otherwise any client
  can forge `X-Forwarded-For`. This repository cannot enforce that
  (`docker-compose.yml` publishes `3001:3001` and is outside this change's
  scope), so it is documented in `.env.example` as a deployment requirement.
- The hop count must be re-verified whenever proxies are added or removed.

## Verification

- `backend/src/config/config.test.ts` covers all accepted and rejected forms.
- `backend/src/trustProxy.test.ts` asserts the compiled Express setting, that
  a disabled setting ignores `X-Forwarded-For` in audit records and in rate
  limit bucketing, that hop count `1` records the rightmost (proxy-appended)
  forwarded entry as the client IP while discarding client-supplied entries,
  and that explicit address lists ignore forwarded headers from unlisted
  sockets.
