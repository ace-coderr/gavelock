# Status

Updated 16 November 2026. To resume in a new session: read this file and `docs/PROTOCOL.md`, then say "continue".

## Dates

- Feature freeze: 28 November 2026
- Deadline: 7 December 2026, 23:59 UTC

## Task track

| # | Task | State |
|---|---|---|
| 0 | Protocol spike, cost table | Done. Gate A approved 16 November. |
| 1 | Monorepo scaffold + GitHub Pages deploy | Done 16 November. |
| 2 | Core library: bid encoding, banding, rule compiler, time-lock sealing | Done 16 November (78 tests). |
| 3 | Contracts + tests on an X Layer fork | Done 17 November: rule stock, tender, panel, records, award library, abnormally-low rule. |
| 4 | Web app | Built: Board, Studio, Rules, Prover, rule builder, tender tabs, Supplier, Buyer, Verify, Docs. Tender pages are first used live after Gate B. |
| 5 | MCP package | Done 17 November (9 tests, stdio round trip). |
| 6 | Audit pass | Done 17 November: docs/AUDIT.md. |
| 7 | Mainnet plan, Gate B, deploy, real tenders | **At Gate B: docs/GATE-B.md. Nothing sent to mainnet.** |
| 8 | DeWEB dry run, Gate C | **Dry run done: docs/GATE-C.md (977,312 bytes, 48 transactions, about 0.085 OKB). Waiting for Gate B, then approval.** |
| 9 | README + docs/SUBMISSION.md | README done (deployment fields fill in after Gate B); SUBMISSION.md not written yet. |

## Live site

https://ace-coderr.github.io/gavelock/ is deployed by `.github/workflows/deploy.yml` on every push to main (Pages source: GitHub Actions). The workflow typechecks, runs unit tests, builds `web/` and fails if the build references another origin.

## Gates

- Gate A (cost table): **approved** 16 November 2026. Nothing has been spent.
- Gate B (mainnet deploy): **two options ready, neither approved**: full (docs/GATE-B.md, about 0.06 OKB) and lean (docs/GATE-B-LEAN.md, one rule, about 0.025 OKB). Both need 0.12 BEM. No deploy key exists. Other rules can be added later with `scripts/add-rules.ts`.
- Gate C (DeWEB dry run): **dry run done, waiting for approval**: docs/GATE-C.md.

## Conditions set at Gate A (binding for Task 3)

1. **Stock contract.** Create the processor and mint the entire transistor supply into the stock contract, mint price 0, in one transaction (or prove on the fork that nobody can mint in between). Nobody else may be able to mint or exhaust the supply. Supply in the millions. A small custom-rule fee in OKB goes to Gavelock's fee address on top of the 0.0013 OKB tape-out fee. The caller must end up owning the circuit. Prove all of it on the fork; if it fails, stop and tell the owner.
2. **Documents as contract code**, like the ciphertexts, not only in events, if the measured cost stays under 0.001 OKB per 100 KB. The Audit Pack must not depend on a node keeping old logs. SHA-256 on chain either way.
3. **Paged finalize.** Anyone can call any page; the award is identical for every page size and caller; ties resolve the same way; the challenge recompute uses the same paged path. Tests for each.

Approved as written: block numbers on every record, bid ciphertexts as contract code, the 1,500-NAND cap in the rule builder.

## Task 3 progress

**Gate A condition 1 is proven on the fork** (`packages/contracts/test/fork/ruleStock.fork.test.ts`, 15 tests, run with `npm run test:fork`):

- `RuleStock.open()` creates the processor (mint price 0, supply 100,000,000) and mints the entire supply to itself in one transaction: 999,058 gas, 0.1 + 0.01 BEM pulled from the caller by allowance to the stock.
- After that `minted == supplyCap`, so a stranger with the fee token and an allowance cannot mint NAND or LATCH (`supply cap`). The stock has three state-changing functions (`open`, `tapeOut`, `withdrawFees`) and none moves transistors.
- A caller with no fee token and no transistors tapes out a rule for exactly `TAPEOUT_FEE + ruleFee` in OKB and owns the circuit. Starter rules cost 352,925 to 744,458 gas each through the stock.
- The rule fee (0.002 OKB in the tests; fixed at deployment, final value at Gate B) accrues and goes to the fee address when anyone calls `withdrawFees`.
- Only flat NAND netlists of 11 inputs / 5 outputs and at most 1,500 gates are accepted. A 1,500-gate rule costs 4,906,243 gas to tape out and 3,486,102 gas per `eval`.
- Draining the stock needs 66,665 maximum-size tape-outs: 86.66 OKB in TapeOut fees plus the rule fees.
- Each starter rule returns its core-library truth table through on-chain `eval` on all 2,048 inputs.

Deploy order this implies for Gate B: deploy `RuleStock`, approve it for 0.11 BEM, call `open()`, tape out the four starter rules through `tapeOut()`.

Still to build in Task 3: the tender contract (lifecycle, documents and ciphertexts as contract code, panel commit-reveal, paged finalize, challenges, pull refunds), its tests, and the measurements for conditions 2 and 3.

## Abnormally low bid rule (added to Task 3)

Specified in `packages/core` (`banding.ts`, `award.ts`), implemented in the contracts, 78 core tests and 25 contract unit tests pass.

- Per-tender parameter `abnormalFloorBps` (default 7000, 0 = off, at most 10,000), frozen with the other parameters. Compliant bids = opened, not disqualified, every mandatory item claimed. Median compliant price: even count = mean of the middle two, rounded down. Abnormally low = `price * 10000 < median * floor`. Needs at least 3 compliant bids.
- The reference price is the lowest compliant price that is not abnormally low. A flagged bid stays eligible, gets price band 0 and a public flag (`getBid(...).abnormallyLow`).
- Compliant bids are kept in a price-ordered linked list as they are opened. `openBid` takes a `hint` (index + 1 of any listed bid that sorts before the new one, or 0). A hint only saves gas; one that is not listed or does not sort before the bid reverts, and no hint can change the order. Core helper: `openingHint`.
- `finalize` stages: 1 walk to the median, 2 skip the flagged prefix, 3 score. Paged, any caller; an upheld challenge unlinks the bid and restarts at stage 0 through the same path.
- Size: the award logic moved to a linked library `AwardEngine` (7,517 bytes). `Gavelock` is 18,986 bytes (limit 24,576). Deploy order: `AwardEngine`, then `Gavelock` linked to it. Shared structs are in `Types.sol`.
- Honest limit recorded in `docs/PROTOCOL.md` section 8: several fake low bids can still move the median.
- **Fork results** (`test/fork/abnormal.fork.test.ts`, 9 tests, real circuits): the lowball attack on a quality-weighted rule with a real panel flattens every real price band with the rule off and changes nothing with it on; seven page-size plans and different callers give identical awards equal to the core reference; a recompute after three disqualifications matches too.
- **Gas** (X Layer, 0.02 gwei; `packages/contracts/reports/gas-abnormal-rule.json`): finalize over 3 / 10 / 50 bids in one call is 364,093 / 887,394 / 3,865,105 gas with the rule on, 355,770 / 871,127 / 3,810,099 off, so the rule adds 8,323 / 16,267 / 55,006 gas. Pages of 10 at 50 bids: 8 calls, largest 816,184 gas. Opening a bid with the exact hint costs about 140,000 gas at any count; the 50th (most expensive) bid with no hint costs 366,612.

## Decisions made in Task 2 (the contract must match these exactly)

The TypeScript in `packages/core` is the specification; contract tests compare the two.

- **Rule input, 11 bits:** price band (bits 0-2), delivery band (3-4), mandatory (5), preferred A (6), preferred B (7), panel band (8-10). **Output, 5 bits:** eligible (0), score 0-15 (1-4). `eval` takes 2 bytes and returns 1.
- **Sealed plaintext:** `abi.encode(uint256 price, uint32 deliveryDays, uint32 compliance, string note, bytes32 salt)`. Note at most 280 UTF-8 bytes. Price from 1 to 2^128-1.
- **Commitment:** `keccak256(abi.encode(uint256 chainId, address tenderContract, uint256 tenderId, address bidder, price, deliveryDays, compliance, note, salt))`. Binding the bidder means a copied commitment can never be opened.
- **Lowest valid price:** lowest price among opened, non-disqualified bids that claim every mandatory item. A non-compliant lowball cannot shift everyone else's price band.
- **Price band:** number of the 7 ladder steps (basis points) with `price * 10000 > lowest * (10000 + step)`. Band 7 when there is no valid price. Default ladder 0, 250, 500, 1000, 1500, 2500, 4000.
- **Delivery band:** number of the 3 ladder steps (days) the delivery time exceeds. Default 7, 14, 30.
- **Checklist:** up to 32 items; three disjoint masks (mandatory, preferred A, preferred B). A group is earned only by claiming all of it; an empty preferred group is never earned; an empty mandatory group is always met.
- **Panel:** scores 0-100; median of revealed scores, even count = mean of the two middle scores rounded down; band = floor(median * 8 / 101). Quick Quote uses band 0.
- **Ranking:** higher score, then lower price, then lower bid index. A total order, so the winner is independent of processing order (the basis for paged finalize).
- **Starter rules** (form weights, no gates): lowest price = price 100 (15 NAND); price 60 / quality 40 (141 NAND); quality 70 / price 30 (133 NAND); fastest delivery = delivery 100 (12 NAND). Score = round-half-up of 15 * weighted fraction, integer arithmetic.
- **Sealing:** `@gavelock/core/seal`. Sealing is offline; opening fetches one drand round and verifies its signature. The ciphertext on chain is the binary age payload (583 bytes for a short note, about 810 for a 240-character note).

## Stretch of 17 November: lean profile and UI pass

- **Lean Gate B** (docs/GATE-B-LEAN.md): one rule, 0.001 OKB tender fee, 2 demo bidders, about 0.025 OKB plus 0.12 BEM. Rehearsed on the fork. Other rules later with `scripts/add-rules.ts`. Nothing sent to mainnet; no deploy key.
- **UI pass**: warm dark theme (tokens in `web/src/styles/tokens.css`), Instrument Serif and Inter (Latin, local), pinned stage wheel, sticky split sections, glass over the bids, receipts, chips and switches, panel seats, drag rows. Audited in docs/AUDIT.md (10 fixes). Site is 970,824 bytes. Open: frame rate and real-touch checks.

## Wheel rework (18 November)

- One continuous dial from hero to footer (`web/src/components/LandingWheel.tsx`, scenes in `DialScenes.tsx`), replacing both wheels; new headline pictures (`HeadlinePics.tsx`); rewritten footer, builder byline removed everywhere. Audit in docs/AUDIT.md. Bundle 998,839 bytes (little room left). Open: phone frame rate, real-touch check, sound heard.

## Large wheel and headline pictures (18 November)

- Hero dial back to a large, cropped dial (active stage at its left, or at its top on narrow screens), solid navbar, headline pictures finished by default with captions under the headline. See docs/AUDIT.md for what was and was not re-verified (scroll, dock and frame rate need re-checking in a visible browser). Bundle 1,000,458 bytes; the 700 KB goal is not met (breakdown in the audit).

## What exists

- Root npm workspaces: `packages/core` (chain constants, deployment record, drand rounds, rule layout / form / NAND compiler / netlist codec and simulator, bid encoding and commitment, banding, reference award, time-lock sealing; 60 tests), `packages/contracts` (Hardhat 3 fork config, TapeOut interfaces, fork smoke test: `npm run test:fork`), `web` (React-compatible components on Preact, with Vite; hash routing, hash routing, tokens in `web/src/styles/tokens.css`, Tender Board with live X Layer facts, How it works page). `packages/mcp` is created in Task 5.
- Commands: `npm run typecheck`, `npm test`, `npm run build`, `npm run dev`, `npm run test:fork`.
- `spike/`: read-only mainnet checks, a Hardhat fork cost script, a probe contract, the tlock checks. Raw results in `spike/out/`. Standalone, not part of the workspaces.
- `docs/PROTOCOL.md`: verified addresses, interfaces, limits, costs, trust boundaries, plan changes.

## Facts to remember

- Chain 196, OP-stack, 1-second blocks, 0.02 gwei. Hardhat 3 forks it with chain type `op` and `hardforkHistory: { isthmus: { blockNumber: 0 } }`.
- Factory `0x1f09daefa827f02cbb40967cc91b259763760761`. `createCPU` takes 0.1 BEM by allowance. `mint` on a new processor takes 0.01 BEM per call by allowance. `tapeout` takes exactly 0.0013 OKB.
- BEM `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`, 8 decimals.
- `eth_getLogs` is limited to 100 blocks; `eth_call` to 50M gas; `eth_simulateV1` exists only on `xlayer.drpc.org`.
- Rule circuits: 11 inputs, 5 outputs. Starter rules are 15 to 141 NAND.
- drand quicknet chain hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`, 3-second rounds.
