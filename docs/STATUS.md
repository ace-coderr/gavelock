# Status

Updated 16 November 2026. To resume in a new session: read this file and `docs/PROTOCOL.md`, then say "continue".

## Dates

- Feature freeze: 28 November 2026
- Deadline: 7 December 2026, 23:59 UTC

## Task track

| # | Task | State |
|---|---|---|
| 0 | Protocol spike, cost table | Done. Gate A approved 16 November. |
| 1 | Monorepo scaffold + GitHub Pages deploy | **In progress** |
| 2 | Core library: bid encoding, banding, rule compiler, time-lock sealing | Not started (a spike-grade compiler exists in `spike/scripts/lib/rules.mjs`) |
| 3 | Contracts + tests on an X Layer fork | Not started |
| 4 | Web app | Not started |
| 5 | MCP package | Not started |
| 6 | Audit pass | Not started |
| 7 | Mainnet plan, Gate B, deploy, real tenders | Not started |
| 8 | DeWEB dry run, Gate C | Not started |
| 9 | README + docs/SUBMISSION.md | Not started |

### Task 1 progress

- Done: root npm workspaces (`packages/*`, `web`), `packages/core` (chain constants, drand round arithmetic, 4 passing tests), `packages/contracts` (Hardhat 3 fork config, TapeOut interfaces, 5 passing fork smoke tests via `npm run test:fork`).
- Left: `web/` shell (React + Vite + TS, hash routing, navbar and footer, one design-token layer, fonts bundled locally, Tender Board with an honest empty state, footer "Built by" + `ace` pill), `.github/workflows` Pages deploy (build `web/`, deploy on push to main), set the Pages source to GitHub Actions (the Pages site does not exist yet: `gh api repos/ace-coderr/gavelock/pages` returns 404), confirm the live URL.
- `packages/mcp` is created in Task 5, not before.

## Gates

- Gate A (cost table): **approved** 16 November 2026. Nothing has been spent.
- Gate B (mainnet deploy): not reached. BEM is bought by the owner at Gate B, not before. At Gate B: re-read the live fees, say exactly where to swap and how much.
- Gate C (DeWEB dry run): not reached.

## Conditions set at Gate A (binding for Task 3)

1. **Stock contract.** Create the processor and mint the entire transistor supply into the stock contract, mint price 0, in one transaction (or prove on the fork that nobody can mint in between). Nobody else may be able to mint or exhaust the supply. Supply in the millions. A small custom-rule fee in OKB goes to Gavelock's fee address on top of the 0.0013 OKB tape-out fee. The caller must end up owning the circuit. Prove all of it on the fork; if it fails, stop and tell the owner.
2. **Documents as contract code**, like the ciphertexts, not only in events, if the measured cost stays under 0.001 OKB per 100 KB. The Audit Pack must not depend on a node keeping old logs. SHA-256 on chain either way.
3. **Paged finalize.** Anyone can call any page; the award is identical for every page size and caller; ties resolve the same way; the challenge recompute uses the same paged path. Tests for each.

Approved as written: block numbers on every record, bid ciphertexts as contract code, the 1,500-NAND cap in the rule builder.

## What exists

- `spike/`: read-only mainnet checks, a Hardhat fork cost script, a probe contract, the tlock checks. Raw results in `spike/out/`. Standalone, not part of the workspaces.
- `docs/PROTOCOL.md`: verified addresses, interfaces, limits, costs, trust boundaries, plan changes.

## Facts to remember

- Chain 196, OP-stack, 1-second blocks, 0.02 gwei. Hardhat 3 forks it with chain type `op` and `hardforkHistory: { isthmus: { blockNumber: 0 } }`.
- Factory `0x1f09daefa827f02cbb40967cc91b259763760761`. `createCPU` takes 0.1 BEM by allowance. `mint` on a new processor takes 0.01 BEM per call by allowance. `tapeout` takes exactly 0.0013 OKB.
- BEM `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`, 8 decimals.
- `eth_getLogs` is limited to 100 blocks; `eth_call` to 50M gas; `eth_simulateV1` exists only on `xlayer.drpc.org`.
- Rule circuits: 11 inputs, 5 outputs. Starter rules are 15 to 141 NAND.
- drand quicknet chain hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`, 3-second rounds.
