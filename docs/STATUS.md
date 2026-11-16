# Status

Updated 16 November 2026. To resume in a new session: read this file and `docs/PROTOCOL.md`, then say "continue".

## Dates

- Feature freeze: 28 November 2026
- Deadline: 7 December 2026, 23:59 UTC

## Task track

| # | Task | State |
|---|---|---|
| 0 | Protocol spike, cost table | **Done. Waiting at Gate A.** |
| 1 | Monorepo scaffold + GitHub Pages deploy | Not started |
| 2 | Core library: bid encoding, banding, rule compiler, time-lock sealing | Not started (a spike-grade compiler exists in `spike/scripts/lib/rules.mjs`) |
| 3 | Contracts + tests on an X Layer fork | Not started |
| 4 | Web app | Not started |
| 5 | MCP package | Not started |
| 6 | Audit pass | Not started |
| 7 | Mainnet plan, Gate B, deploy, real tenders | Not started |
| 8 | DeWEB dry run, Gate C | Not started |
| 9 | README + docs/SUBMISSION.md | Not started |

## Gates

- **Gate A (cost table): open.** Table is in `docs/PROTOCOL.md` section 7. Nothing has been spent.
- Gate B (mainnet deploy): not reached.
- Gate C (DeWEB dry run): not reached.

## Decisions waiting on the owner

1. Approve the cost table: about 0.018 OKB for the processor and four rules (0.11 BEM + 0.0052 OKB), under 0.001 OKB of gas for contracts and both demo tenders, 0.08 OKB more if the site is later published through DeWEB.
2. The processor fee is now paid in BEM, not OKB. The deploy wallet needs 0.15 BEM before Gate B; buying it is the owner's step.
3. Accept or reject the five plan changes in `docs/PROTOCOL.md` section 9 (stock contract for custom rules, block numbers on every record, ciphertext as contract code, paged finalize, 1,500-NAND cap).

## What exists

- `spike/`: read-only mainnet checks, a Hardhat fork cost script, a probe contract, the tlock checks. Raw results in `spike/out/`.
- `docs/PROTOCOL.md`: verified addresses, interfaces, limits, costs, trust boundaries.

## Facts to remember

- Chain 196, OP-stack, 1-second blocks, 0.02 gwei. Hardhat 3 forks it with chain type `op` and `hardforkHistory: { isthmus: { blockNumber: 0 } }`.
- Factory `0x1f09daefa827f02cbb40967cc91b259763760761`. `createCPU` takes 0.1 BEM by allowance. `mint` on a new processor takes 0.01 BEM per call by allowance. `tapeout` takes exactly 0.0013 OKB.
- BEM `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`, 8 decimals.
- `eth_getLogs` is limited to 100 blocks; `eth_call` to 50M gas; `eth_simulateV1` exists only on `xlayer.drpc.org`.
- Rule circuits: 11 inputs, 5 outputs. Starter rules are 15 to 141 NAND.
- drand quicknet chain hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`, 3-second rounds.

## Next step after Gate A

Task 1: npm workspaces (`web`, `packages/core`, `packages/contracts`, `packages/mcp`), move the fork setup from `spike/` into `packages/contracts`, GitHub Actions workflow that builds `web/` and deploys to Pages.
