# Security Model

## Overview

Stateless trust scoring service with defense-in-depth input validation and rate limiting.

## Input Validation

### Wallet Address

All wallet addresses are validated with Zod and the regex `^[A-Z2-7]{58}$`:

- Exactly 58 characters
- Uppercase A-Z, digits 2-7 (Algorand base32 encoding)
- Rejects empty, short, long, lowercase, or special-character inputs

### Request Body Limits

- `express.json({ limit: '100kb' })` — prevents payload-based DoS

## Rate Limiting

### Global Rate Limit

- 100 requests per minute per IP (configurable via `express-rate-limit`)
- Applied to all routes

### Per-Wallet Rate Limit

Not implemented — global rate limit only.

## No Payment Security

This service does not implement x402 payments, credit delegation, or any payment flow. All endpoints are free and stateless.

## No Admin Auth

No admin endpoints, no API keys, no admin authentication.

## Network Security

### CORS

- Configurable allowed origins
- Defaults to `http://localhost:3000`

### CSP (Content Security Policy)

- Set via Helmet middleware
- Restrictive defaults

### TLS

- Production deployments should use TLS termination (nginx, cloud LB)
- Helmet middleware sets security headers

## Known Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| **In-memory rate limiter** | Resets on restart, not distributed | Use Redis for production |
| **No HTTPS enforcement** | TLS depends on deployment | Use TLS termination at LB |
| **No authentication** | Any client can query any wallet | Rate limiting, input validation |

## Delegation Trust Security

### Trust Amplification Vulnerability (Mitigated)

**Before fix:** A wallet could inflate delegation trust by creating multiple sybil wallets and delegating to them. The `sponsorCountScore` gave equal weight to all sponsors regardless of quality, allowing trust to be "created from nothing."

**Attack scenario:**
1. Attacker creates 5 wallets with 0 trust
2. Attacker delegates to all 5
3. Before fix: delegation trust = 43 (from depthScore=80, countScore=100)
4. After fix: delegation trust ≤ 0 (quality-weighted count + depth-adjusted cap)

**Mitigations applied:**
1. **Quality-weighted sponsor count:** `computeSponsorCountScore(count, avgQuality)` — low-quality sponsors contribute less
2. **Depth-adjusted trust cap:** `delegationTrustScore ≤ max(sponsorTrust) - depth × 20` — trust attenuates with graph distance, preventing relative amplification
3. **Sybil detection:** Underwriting layer flags clustered wallets with high interaction density

**Mathematical proof of depth amplification prevention:**
- For wallets A (depth d+1) and B (depth d) with same sponsor quality Q:
- Raw difference: `Raw_A - Raw_B = -7 + 0.12Q ≤ 5`
- Cap_A = Q - (d+1)×20, Cap_B = Q - d×20
- For d ≥ 1: Cap_A = Q - 40 < Q - 7 ≤ trustScore(B)
- Therefore trustScore(A) < trustScore(B) ✓

### Circular Delegation (Mitigated)

**Attack:** A → B → C → A to inflate depth or count.

**Mitigation:** BFS with visited set prevents cycles from increasing depth. Each node is visited exactly once.

### Depth Amplification (Mitigated)

**Attack:** Chain of sponsors to inflate depth score.

**Mitigation:** Depth score decreases monotonically (100 → 80 → 60 → 40 → 0 at depth 7). Trust cannot increase through depth alone.

### Whale Delegation (Mitigated)

**Attack:** Single massive delegation to inflate amount score.

**Mitigation:** Amount score uses log scale (10K ALGO = 100, same as 100K ALGO). Diminishing returns prevent whale domination.

## Data Protection

- No PII stored — only Algorand wallet addresses processed
- No database — all data is fetched from Algorand testnet per request
- No logging of sensitive data
- Stack traces logged server-side only
