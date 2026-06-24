# Trust Scoring Algorithm

## Overview

The trust score (0-100) is a weighted composite of five sub-scores, each measuring a different aspect of wallet trustworthiness. All computation is stateless — no database, no prior state.

## Formula

```
trustScore = Σ (weight_i × score_i) / Σ weight_i
```

Weights are normalized at runtime.

| Component | Weight | Score Function |
|-----------|--------|----------------|
| Age | 0.20 | `computeAgeScore(days)` |
| Activity | 0.25 | `computeActivityScore(txns, days, assets)` |
| Volume | 0.20 | `computeVolumeScore(balanceMicroAlgo, txns)` |
| Velocity | 0.15 | `computeVelocityScore(txns, days)` |
| Compliance | 0.20 | `computeComplianceScore(balanceMicroAlgo, txns)` |

## Sub-Scores

### Age Score (`computeAgeScore`)

Measures wallet longevity using a blend of linear and logarithmic ramps over 730 days.

```
if days <= 0: return 0
if days >= 730: return 100

linear = (days / 730) × 100
log = (log10(days + 1) / log10(731)) × 100

return 0.6 × linear + 0.4 × log
```

- **Linear component (60%)**: rewards consistent aging proportionally
- **Log component (40%)**: gives diminishing returns after ~1 year
- **730 days (2 years)**: maximum score of 100

### Activity Score (`computeActivityScore`)

Measures transaction frequency, account age, and portfolio diversification.

```
txPerMonth = txns / (days / 30)

return min(100,
  min(40, txPerMonth × 2) +
  min(30, (days / 365) × 30) +
  min(30, assets × 3)
)
```

Three capped components:
- **Transaction frequency**: up to 40 points (20 txns/month → 40)
- **Account age**: up to 30 points (1 year → 30)
- **Asset diversification**: up to 30 points (10 assets → 30)

### Volume Score (`computeVolumeScore`)

Measures balance size and transaction count.

```
algo = balanceMicroAlgo / 1_000_000

return min(100,
  min(50, log10(max(1, algo)) × 10) +
  min(50, txns × 0.5)
)
```

Two capped components:
- **Balance**: up to 50 points (logarithmic — 10 ALGO → 10, 100 → 20, 1000 → 30)
- **Transaction count**: up to 50 points (100 txns → 50)

### Velocity Score (`computeVelocityScore`)

Inverse scoring — penalizes high transaction rates (bot/spam behavior).

```
if days === 0: return 0
perDay = txns / max(1, days)

if perDay > 50: return 20
if perDay > 20: return 40
if perDay > 5:  return 60
if perDay > 1:  return 80
return 100
```

| Transactions/Day | Score | Interpretation |
|-------------------|-------|----------------|
| > 50 | 20 | Likely automated/bot |
| > 20 | 40 | Very high activity |
| > 5 | 60 | High activity |
| > 1 | 80 | Moderate activity |
| ≤ 1 | 100 | Normal pace |

### Compliance Score (`computeComplianceScore`)

Penalty-based scoring with continuous penalties (not binary thresholds).

```
algo = balanceMicroAlgo / 1_000_000
balancePenalty = algo >= 1 ? 0 : round((1 - algo) × 40)
txnPenalty = txns === 0 ? 50 : round(max(0, 50 - log10(txns + 1) × 25))
score = 100 - balancePenalty - txnPenalty

return max(0, min(100, score))
```

**Design rationale (credit bureau alignment):**
- Binary thresholds create cliff effects that are gameable
- Continuous penalties provide smoother graduation between risk levels
- Floor of 10 (not 0) because even worst wallet technically exists on-chain
- FICO doesn't score dormant files at all; we give minimal credit

| Component | Range | Scale |
|-----------|-------|-------|
| Balance penalty | 0-40 | Linear below 1 ALGO |
| Transaction penalty | 0-50 | Log₁₀ (0 txns = 50, 100+ txns ≈ 0) |
| Worst case | 100-40-50 = 10 | Floor |

**Examples:**

| Balance | Txns | Balance Penalty | Txn Penalty | Score |
|---------|------|----------------|-------------|-------|
| 1.0 ALGO | 100 | 0 | 0 | 100 |
| 1.0 ALGO | 10 | 0 | 24 | 76 |
| 0.5 ALGO | 10 | 20 | 24 | 56 |
| 0 ALGO | 10 | 40 | 24 | 36 |
| 1.0 ALGO | 0 | 0 | 50 | 50 |
| 0 ALGO | 0 | 40 | 50 | 10 |

## Composite Trust Score

```
w = { age: 0.2, activity: 0.25, volume: 0.2, velocity: 0.15, compliance: 0.2 }
total = sum of all weights

trustScore = round(
  (w.age / total) × ageScore +
  (w.activity / total) × activityScore +
  (w.volume / total) × volumeScore +
  (w.velocity / total) × velocityScore +
  (w.compliance / total) × complianceScore
)
```

## Risk Classification

```
if score >= 70:  return 'low'
if score >= 45:  return 'medium'
if score >= 20:  return 'high'
return 'critical'
```

| Level | Score Range | Description |
|-------|-------------|-------------|
| `low` | 70-100 | Strong trust profile |
| `medium` | 45-69 | Acceptable with monitoring |
| `high` | 20-44 | Elevated risk |
| `critical` | 0-19 | High risk, additional verification needed |

## Recommended Limit

```
base = (trustScore / 100) × 500
tier = 1.5  if score >= 80
      1.2  if score >= 60
      1.0  if score >= 40
      0.7  otherwise

recommendedLimit = round(base × tier, 2)
```

| Trust Score | Base | Tier | Recommended Limit |
|-------------|------|------|-------------------|
| 90 | 450 | 1.5 | $675.00 |
| 70 | 350 | 1.2 | $420.00 |
| 50 | 250 | 1.0 | $250.00 |
| 30 | 150 | 0.7 | $105.00 |

## Approval Threshold

```
approved = trustScore >= 40
```

Wallets with `trustScore >= 40` are approved. Below 40, additional verification is recommended.

## Explanation Generation

`generateExplanation()` produces human-readable reasons based on on-chain data:

1. **Wallet history** — "> 1 year", "> 1 month", or "New wallet with limited history"
2. **Transaction count** — "> 100 txns — active", "> 10 txns — moderate", or "limited activity"
3. **Balance** — "well-funded" (> 100 ALGO), standard (> 1 ALGO), or "low balance"
4. **Diversification** — "> 5 assets — diverse portfolio" (if applicable)
5. **Profile strength** — "Strong" (>= 70), "Moderate" (>= 40), or "Weak" (< 40)

## On-Chain Data

### Account Info (via Algod)

| Field | Source |
|-------|--------|
| `amount` | Account balance in microAlgo |
| `assetCount` | Number of opted-in ASAs |
| `appCount` | Number of created apps |
| `createdRound` | Round when account was created |
| `lastRound` | Current latest round |

### Transaction History (via Indexer)

| Field | Source |
|-------|--------|
| `totalTxns` | Count of transactions (up to 500) |
| `firstRound` | Lowest confirmed round |
| `lastRound` | Highest confirmed round |

### Derived: Account Age

```
accountAgeDays = max(1, floor(((latestRound - createdRound) × 3.3) / 86400))
```

Uses 3.3 seconds per round (Algorand's ~3.3s block time).

---

## Delegation Trust Model

### Overview

Delegation trust measures trust earned through an agent's endorsement network. It answers: "How much can we trust this wallet based on who it vouches for and who vouches for it?"

The model uses a **hub score** interpretation (outgoing endorsements → trust), analogous to PageRank's hub score in web link analysis.

### Formula

```
delegationTrustScore = 0.35 × depthScore
                     + 0.30 × sponsorQualityScore
                     + 0.15 × sponsorCountScore
                     + 0.20 × amountScore
```

All weights are normalized (sum = 1.0). The score is capped at `max(sponsorTrustScores)` to prevent trust amplification.

| Component | Weight | Score Function | Range |
|-----------|--------|----------------|-------|
| Depth | 0.35 | `computeDepthScore(depth)` | 0-100 |
| Sponsor Quality | 0.30 | `computeSponsorQualityScore(avgScore)` | 0-100 |
| Sponsor Count | 0.15 | `computeSponsorCountScore(count, avgQuality)` | 0-100 |
| Amount | 0.20 | `computeAmountScore(totalMicroAlgo)` | 0-100 |

### Sub-Scores

#### Depth Score (`computeDepthScore`)

Measures distance from trust anchor. Trust attenuates with graph distance.

```
if depth === 0: return 100  (trust anchor)
if depth === 1: return 80
if depth === 2: return 60
if depth === 3: return 40
return max(0, 40 - (depth - 3) × 10)
```

**Design rationale:**
- Depth 0 = 100: Trust anchors (deployed the registry) get maximum depth score
- Each hop reduces score by 20 (for first 3 hops), then 10 per hop
- At depth 7, score reaches 0 — no trust from chains deeper than 7
- Aligns with credit bureau model: "a 5-year-old delinquency carries less weight"

**Monotonicity proof:** `depthScore(d) ≥ depthScore(d+1)` for all d ≥ 0. Verified by test.

#### Sponsor Quality Score (`computeSponsorQualityScore`)

Pass-through of average sponsor trust score (0-100).

```
return round(max(0, min(100, sponsorScore)))
```

#### Sponsor Count Score (`computeSponsorCountScore`)

Quality-weighted count of sponsors. Prevents trust inflation from sybil endorsement farms.

```
raw = count × 20
qualityMultiplier = max(0.1, avgQuality / 100)
return max(0, min(100, round(raw × qualityMultiplier)))
```

**Design rationale:**
- 5 low-quality sponsors should not equal 5 high-quality sponsors
- Quality multiplier prevents trust creation from nothing
- Minimum multiplier of 0.1 ensures some credit for having sponsors
- Cap at 100 (5+ sponsors with perfect quality)

| Count | Quality=100 | Quality=50 | Quality=0 |
|-------|-------------|------------|-----------|
| 0 | 0 | 0 | 0 |
| 1 | 20 | 10 | 2 |
| 3 | 60 | 30 | 6 |
| 5 | 100 | 50 | 10 |

#### Amount Score (`computeAmountScore`)

Log-scaled score based on total delegated amount.

```
algo = amountMicroAlgo / 1_000_000
if algo <= 0: return 0
if algo >= 10000: return 100
return round(min(100, log10(max(1, algo) + 1) × 25))
```

**Design rationale:**
- Log scale prevents whale domination (10K ALGO = 100, same as 100K ALGO)
- 1 ALGO gives minimal score, 10 ALGO gives moderate, 1000+ gives high
- Cap at 100 prevents extreme amounts from dominating

### Trust Amplification Prevention

**Theorem:** `delegationTrustScore(A) ≤ max(sponsorTrustScores(A)) - (depth(A) × 20)` for all wallets A with depth ≥ 1.

**Proof:** After computing the weighted sum, we apply:
```typescript
if (sponsorScores.length > 0) {
  const maxSponsorTrust = Math.max(...sponsorScores);
  const depthPenalty = depth * 20;
  const adjustedCap = Math.max(0, maxSponsorTrust - depthPenalty);
  trustScore = Math.min(trustScore, adjustedCap);
}
```

**Why depth × 20:** For wallets A (depth d+1) and B (depth d) with the same sponsor quality Q:
- Raw difference: `Raw_A - Raw_B = -7 + 0.12Q ≤ 5` (for Q ≤ 100)
- Cap_A = Q - (d+1)×20, Cap_B = Q - d×20
- For d ≥ 1: Cap_A = Q - 40 < Q - 7 ≤ trustScore(B)
- Therefore trustScore(A) < trustScore(B) ✓

**Before fix (vulnerable):**
- Wallet at depth 2 with 5 sponsors (trustScore=90) → delegation trust = 63.1
- Wallet at depth 1 with 1 sponsor (trustScore=90) → delegation trust = 59.3
- Trust amplified through sponsor count (63.1 > 59.3)

**After fix:**
- Wallet at depth 2: raw 63.1, cap = 90 - 40 = 50 → **50**
- Wallet at depth 1: raw 59.3, cap = 90 - 20 = 70 → **59.3**
- No amplification (50 < 59.3) ✓

### Cycle Detection

BFS traversal with visited set prevents circular delegations from increasing depth.

**Example:** A → B → C → A
- Start at A (depth=0, visited={A})
- Visit B (depth=1, visited={A,B})
- Visit C (depth=2, visited={A,B,C})
- Try A → already visited, skip
- Max depth = 2 (not 3)

**Proof:** Cycles cannot increase trust because:
1. Depth is bounded by visited set (no node visited twice)
2. Count score is based on outgoing delegations, not cycle length
3. Quality score uses sponsor trust, not cycle membership

### Graph Traversal Complexity

| Metric | Complexity | Notes |
|--------|-----------|-------|
| Time | O(V + E) | V = unique wallets, E = delegation edges |
| Space | O(V) | Visited set + BFS queue |
| Network calls | O(branching × depth) | MAX_BRANCHING_FACTOR=10, maxDepth=10 |
| Worst case | O(100) calls | 10 × 10 |
| Typical case | O(10-50) calls | Most wallets have < 5 delegates |

**Bounded by:**
- `MAX_BRANCHING_FACTOR = 10`: Max nodes expanded per BFS level
- `maxDepth = 10`: Max chain length explored
- `sponsorScores.slice(0, 5)`: Max 5 sponsor trust scores fetched

### Design Decisions

1. **Hub score (outgoing) vs Authority score (incoming):** We use outgoing endorsements because they represent主动 trust decisions by the wallet. Incoming endorsements could be gamed by creating sybil wallets that endorse the target.

2. **Depth weight = 0.35 (highest):** Trust attenuates with distance — a wallet 3 hops from an anchor is less trustworthy than one 1 hop away. This aligns with credit bureau models.

3. **Quality weight = 0.30 (second):** Sponsor quality matters more than count. One high-quality sponsor is worth more than five low-quality ones.

4. **Count capped at 5:** Diminishing returns beyond 5 endorsements. More endorsements don't linearly increase trust.

5. **Amount uses log scale:** Prevents whale domination. 10K ALGO gives same score as 100K ALGO.

6. **Trust capped at max sponsor:** Prevents amplification. A wallet cannot be more trustworthy than its most trustworthy endorser.

### Known Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| Hub score only (no incoming) | Cannot measure "being trusted" directly | Underwriting layer combines with base trust |
| BFS bounded at depth 10 | Very long chains not fully explored | Depth 7+ already gives 0 depth score |
| MAX_BRANCHING_FACTOR=10 | Dense graphs may miss some paths | Most real delegation graphs are sparse |
| No reputation integration | Delegation trust is separate from event reputation | Underwriting combines both |

### Attack Vectors and Mitigations

| Attack | Vector | Mitigation |
|--------|--------|-----------|
| Sybil delegation farm | Create 5 wallets, delegate to all | Quality-weighted count + trust cap |
| Depth amplification | Chain of sponsors to inflate depth | Depth score decreases monotonically |
| Circular endorsement | A→B→C→A to inflate count | BFS cycle detection |
| Whale delegation | Single massive delegation | Amount score uses log scale |
| Count inflation | 100+ sponsors | Count capped at 100 (5×20) |

### Underwriting Integration

Delegation trust is one of 6 factors in the underwriting composite score:

| Factor | Weight | Source |
|--------|--------|--------|
| Trust Score | 0.25 | `scoreWallet()` |
| **Delegation Trust** | **0.15** | `scoreDelegation()` |
| Credit Capacity | 0.20 | `estimateCredit()` |
| Sybil Resistance | 0.15 | `detectSybil()` |
| Reputation | 0.15 | `computeReputation()` |
| On-chain Activity | 0.10 | `trustResult.breakdown.activityScore` |

Delegation trust has 15% weight — significant but not dominant. A wallet with high delegation trust but low base trust will still be limited in the composite score.

---

## Decision Engine Architecture

### Overview

The decision engine is a multi-layered pipeline where each layer produces a score, risk level, and decision. The layers are:

```
┌─────────────────────────────────────────────────────────────┐
│                    COUNTERPARTY VERIFICATION                 │
│  Input: buyer wallet                                        │
│  Output: allow/deny, confidence, riskLevel                  │
│  Sources: onChainScore (60%) + delegationScore (40%)        │
├─────────────────────────────────────────────────────────────┤
│                      UNDERWRITING                            │
│  Input: wallet                                              │
│  Output: approved, compositeScore, recommendedLimit         │
│  Sources: 6 weighted factors (trust, delegation, credit,    │
│           sybil, reputation, activity)                      │
├─────────────────────────────────────────────────────────────┤
│                       PASSPORT                               │
│  Input: wallet                                              │
│  Output: AgentPassport document                             │
│  Sources: all 5 sub-services aggregated                     │
└─────────────────────────────────────────────────────────────┘
```

### Decision Flow

1. **Counterparty Verification** (`counterparty.ts`)
   - Fetches on-chain trust score and delegation score in parallel
   - Computes combined score: `0.6 × onChain + 0.4 × delegation`
   - Decision: `combinedScore >= 40 AND confidence >= 0.45`
   - Used for: real-time transaction verification

2. **Underwriting** (`underwriting.ts`)
   - Orchestrates 5 sub-services in parallel
   - Builds 6 weighted factors
   - Computes composite score via weighted average
   - Multi-condition decision:
     - Deny if sybilRisk >= 0.70
     - Deny if compositeScore < 30
     - Deny if reputation < 10 AND compositeScore < 50
     - Otherwise approve
   - Used for: credit limit recommendations

3. **Passport** (`passport.ts`)
   - Aggregates all 5 sub-services
   - Computes identity strength, payment reliability, overall risk
   - Generates human-readable summary
   - Used for: agent identity documents

### Weight Justification

| Component | Weight | Rationale |
|-----------|--------|-----------|
| **Counterparty** | | |
| On-chain trust | 0.60 | Direct measure of wallet history and behavior |
| Delegation trust | 0.40 | Endorsement network adds independent signal |
| **Underwriting** | | |
| Trust Score | 0.25 | Foundational — most weight on direct evidence |
| Credit Capacity | 0.20 | Financial capacity limits exposure |
| Delegation Trust | 0.15 | Social proof, but less direct than trust |
| Sybil Resistance | 0.15 | Critical for fraud prevention |
| Reputation | 0.15 | Historical behavior record |
| On-chain Activity | 0.10 | Supporting signal, less predictive |
| **Passport** | | |
| Trust risk | 0.30 | Primary risk signal |
| Sybil risk | 0.25 | Critical fraud indicator |
| Reputation risk | 0.25 | Historical behavior |
| Credit risk | 0.20 | Financial capacity |

### Threshold Calibration

| Threshold | Value | Justification |
|-----------|-------|---------------|
| Counterparty approval | 40 | Allows wallets with moderate on-chain history + some delegation |
| Counterparty confidence | 0.45 | Prevents low-confidence approvals with insufficient data |
| Underwriting approval | 30 | Lower than counterparty because more factors are considered |
| Sybil critical | 0.70 | High threshold — only flag clear sybil clusters |
| Fresh wallet cap | 30 | Prevents new wallets from achieving high trust |
| Credit velocity penalty | 40 | Bot-like behavior threshold |
| Credit compliance penalty | 60 | Low usage threshold |
| Passport risk boundaries | 25/50/75 | Different from component scores (70/45/20) because passport is composite |

### Risk Level Boundaries

Different modules use different boundaries for valid reasons:

| Module | Low | Medium | High | Critical | Scale |
|--------|-----|--------|------|----------|-------|
| Trust Score | ≥ 70 | ≥ 45 | ≥ 20 | < 20 | 0-100 |
| Delegation | ≥ 70 | ≥ 45 | ≥ 20 | < 20 | 0-100 |
| Counterparty | ≥ 70 | ≥ 45 | ≥ 20 | < 20 | 0-100 |
| Sybil | < 0.25 | 0.25-0.44 | 0.45-0.69 | ≥ 0.70 | 0-1 |
| Credit (no request) | ≥ 500 | ≥ 200 | ≥ 50 | < 50 | $0-1650 |
| Credit (with request) | ratio ≥ 2.0 | ratio ≥ 1.2 | ratio ≥ 0.8 | ratio < 0.8 | ratio |
| **Passport** | **≤ 25** | **≤ 50** | **≤ 75** | **> 75** | **0-100** |

**Why passport uses different boundaries:** Passport risk is a composite of 4 risk levels mapped to numeric values (low=10, medium=35, high=65, critical=90). The weighted average produces a different distribution than component scores. The boundaries (25/50/75) align with the natural quartiles of this distribution.

### Sensitivity Analysis

**Counterparty:**
- 1-point change in on-chain score → 0.6 change in combined score
- 1-point change in delegation score → 0.4 change in combined score
- On-chain is 1.5x more influential than delegation

**Credit:**
- Each component has independent scale and cap
- Balance capacity: $0.50 per ALGO (cap $1000)
- Activity bonus: $2 per txn (cap $200)
- Age bonus: $0.41/day (cap $150)
- Delegation bonus: $3 per score point (cap $300)
- Risk penalty: continuous 0-150

**Underwriting:**
- Trust score (0.25) is most influential
- Each factor contributes proportionally to its weight
- Sybil risk can override composite score (deny at ≥ 0.70)

### Known Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| Binary approval threshold (40) | Cliff effect at boundary | Confidence threshold adds nuance |
| Missing delegation penalizes credit | New wallets without sponsors get lower limits | Fixed: missing data reduces confidence, not limit |
| Passport risk thresholds differ | May confuse users comparing across modules | Documented: different semantics (composite vs component) |
| Credit risk penalty was binary | Cliff effect at velocity=40, compliance=60 | Fixed: continuous penalties |
| Sybil risk scale differs (0-1 vs 0-100) | Makes comparison difficult | Normalized in underwriting (sybilScore = (1-risk)*100) |

### Adversarial Analysis

| Attack | Vector | Mitigation |
|--------|--------|-----------|
| Sybil endorsement | 5 wallets endorse target → delegation score inflated | Quality-weighted count + depth cap |
| Threshold gaming | Wallet at 39 adds minimal activity to reach 40 | Confidence threshold prevents low-confidence approvals |
| Component isolation | High balance, zero activity → full balance capacity | Cross-component validation in underwriting |
| Fresh wallet bypass | New wallet (< 30 days) gets score 30 via cap | 30 is below approval threshold (40) |
| Sybil override | High composite but critical sybil → denied | Sybil check is first deny condition |

### False Positive/Negative Analysis

**False Positives (allowing bad actors):**
- High balance + zero activity: allowed due to balance alone (credit)
- Delegation from sybil wallets: high delegation score (counterparty)
- Score 40 with confidence 0.45: allowed despite marginal data

**False Negatives (denying good actors):**
- No delegation data: delegation score = 0, penalized (counterparty)
- Moderate on-chain history, no delegation: combined score may be below 40
- High activity, low balance: credit limit may be low
- New wallet with good activity: fresh wallet cap limits score to 30
