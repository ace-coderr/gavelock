# Gate B, lean variant

Prepared 17 November 2026. **Not approved. No deploy key exists. Nothing has been sent to mainnet.**
This is the cut-down option for an owner with little OKB. The full table in [GATE-B.md](GATE-B.md) stays
as the other option. Fees were re-read on 17 November 2026 at block 76,173,513 and are unchanged
(0.1 BEM processor, 0.01 BEM mint, 0.0013 OKB tape-out, 0.02 gwei).

Figures are from rehearsing this exact profile on a fork of X Layer
(`DEPLOY_PROFILE=lean npx hardhat run scripts/rehearse.ts --network xlayerFork`, raw output in
`packages/contracts/reports/rehearsal-lean.json`), with every read-back check passing.

## What is cut

| | Full | Lean |
|---|---|---|
| Starter rules taped out at deployment | 4 | **1: "Price 60 / Quality 40"** |
| Full-tender fee | 0.01 OKB | **0.001 OKB** |
| Custom-rule fee (on top of TapeOut's 0.0013) | 0.0007 OKB | 0.0007 OKB (unchanged) |
| Demo bidder wallets | 3 | **2** |
| Demo panel members | 3 | 3 |
| Demo tenders | one full tender and one Quick Quote | **one full tender** |
| Funding per demo bidder | 0.003 OKB | **0.0013 OKB** (0.001 deposit + gas, 20× margin) |
| Funding per panel member | 0.0005 OKB | **0.0001 OKB** (gas for two calls, 20× margin) |
| Supply, contracts, safeguards | as full | as full |

Why the Quick Quote demo goes: a Quick Quote needs three opened quotes, and the lean profile has two bidder
wallets. It also has no delivery-weighted rule until the other rules are added.

## Deployment, in order (measured on the fork)

| # | Step | Gas | OKB fee | BEM fee |
|---|---|---|---|---|
| 1 | Deploy `RuleStock` | 2,092,620 | | |
| 2 | Approve BEM for the stock | 46,393 | | |
| 3 | `open()`: create the processor, mint the whole 100,000,000 supply | 1,028,242 | | 0.11 |
| 4 | Tape out "Price 60 / Quality 40" (141 NAND) | 812,858 | 0.002 | |
| 5 | Deploy `AwardEngine` | 1,678,433 | | |
| 6 | Deploy `Gavelock` (with its panel and records contracts) | 6,756,247 | | |
| | **Total** | **12,414,793 gas = 0.000248 OKB** | **0.002 OKB** | **0.11 BEM** |

## What the deploy wallet must hold

| Item | OKB |
|---|---|
| One rule: TapeOut 0.0013 + rule fee 0.0007 | 0.0020 |
| One full tender fee | 0.0010 (comes back if the fee address is the deploy wallet) |
| Funding the 2 bidders (2 × 0.0013) and 3 panel members (3 × 0.0001) | 0.0029 (mostly recoverable) |
| Gas: deployment 0.00025 + the demo about 0.0001 | 0.0004 |
| **Subtotal** | **about 0.0063** |
| 0.12 BEM bought from the same wallet, at 0.1026 OKB per BEM plus the pool's 1% fee | about 0.0128 |
| **Total to put in the wallet, with margin** | **0.025 OKB** |

Compare the full profile: about 0.06 OKB. **BEM to buy: 0.12** (0.11 is pulled; 0.01 is margin), at the
BEM / WOKB pool `0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A`. The token is
`0x60e62Efa9405d6873C5deaBD4E6CC91c25363952` (8 decimals): check that address in whichever swap interface you
use. Set a minimum received of 0.115 BEM.

Most of the OKB comes back: the tender fee (if the fee address is the deploy wallet) and every deposit.
The spent amount is the 0.002 OKB rule, the BEM, and gas, about 0.015 OKB.

## Adding the other three rules later: one command each decision

```
CONFIRM_MAINNET=I_APPROVED_THE_GATE_B_TABLE node --env-file=.env packages/contracts/scripts/add-rules.ts all
```

or name rules: `... add-rules.ts lowest-price quality-70-price-30 fastest-delivery`. Each costs 0.002 OKB
(TapeOut 0.0013 + 0.0007) plus about 0.00001 OKB gas, so all three are about 0.006 OKB. The command refuses
to run without the deploy key, the confirmation phrase, an approved and completed deployment, and a live
tape-out price equal to the approved one. It records the new circuit ids in
`packages/contracts/deploy/deployed.xlayer.json`; the app reads them from the chain.

## To approve this variant

1. Say "lean" and give the fee address (proposal: the deploy wallet).
2. Buy 0.12 BEM and hold about 0.025 OKB in the deploy wallet, key in a gitignored `.env`.
3. I create `approved.json` (profile `lean`) and run
   `DEPLOY_PROFILE=lean node --env-file=.env packages/contracts/scripts/deploy-mainnet.ts` with
   `CONFIRM_MAINNET=I_APPROVED_THE_GATE_B_TABLE`. If a TapeOut fee changed, it stops.
