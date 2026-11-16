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
| 2 | Core library: bid encoding, banding, rule compiler, time-lock sealing | Done 16 November. |
| 3 | Contracts + tests on an X Layer fork | **Next** |
| 4 | Web app | Not started |
| 5 | MCP package | Not started |
| 6 | Audit pass | Not started |
| 7 | Mainnet plan, Gate B, deploy, real tenders | Not started |
| 8 | DeWEB dry run, Gate C | Not started |
| 9 | README + docs/SUBMISSION.md | Not started |

## Live site

https://ace-coderr.github.io/gavelock/ is deployed by `.github/workflows/deploy.yml` on every push to main (Pages source: GitHub Actions). The workflow typechecks, runs unit tests, builds `web/` and fails if the build references another origin.

## Gates

- Gate A (cost table): **approved** 16 November 2026. Nothing has been spent.
- Gate B (mainnet deploy): not reached. BEM is bought by the owner at Gate B, not before. At Gate B: re-read the live fees, say exactly where to swap and how much.
- Gate C (DeWEB dry run): not reached.

## Conditions set at Gate A (binding for Task 3)

1. **Stock contract.** Create the processor and mint the entire transistor supply into the stock contract, mint price 0, in one transaction (or prove on the fork that nobody can mint in between). Nobody else may be able to mint or exhaust the supply. Supply in the millions. A small custom-rule fee in OKB goes to Gavelock's fee address on top of the 0.0013 OKB tape-out fee. The caller must end up owning the circuit. Prove all of it on the fork; if it fails, stop and tell the owner.
2. **Documents as contract code**, like the ciphertexts, not only in events, if the measured cost stays under 0.001 OKB per 100 KB. The Audit Pack must not depend on a node keeping old logs. SHA-256 on chain either way.
3. **Paged finalize.** Anyone can call any page; the award is identical for every page size and caller; ties resolve the same way; the challenge recompute uses the same paged path. Tests for each.

Approved as written: block numbers on every record, bid ciphertexts as contract code, the 1,500-NAND cap in the rule builder.

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

## What exists

- Root npm workspaces: `packages/core` (chain constants, deployment record, drand rounds, rule layout / form / NAND compiler / netlist codec and simulator, bid encoding and commitment, banding, reference award, time-lock sealing; 60 tests), `packages/contracts` (Hardhat 3 fork config, TapeOut interfaces, fork smoke test: `npm run test:fork`), `web` (React + Vite shell, hash routing, tokens in `web/src/styles/tokens.css`, Tender Board with live X Layer facts, How it works page). `packages/mcp` is created in Task 5.
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
