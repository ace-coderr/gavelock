# Gate B: approval for the mainnet deployment

Prepared 17 November 2026. **Nothing has been sent to X Layer mainnet.** Every figure below comes from
running the real deployment code on a fork of X Layer (`packages/contracts/scripts/rehearse.ts`, raw
output in `packages/contracts/reports/rehearsal.json`) and from the lifecycle tests
(`packages/contracts/reports/gas.json`). Gas is priced at today's 0.02 gwei.

## Live fees, re-read at block 76,173,513 on 17 November 2026

| Item | Value | Changed since Gate A? |
|---|---|---|
| TapeOut processor fee | 0.1 BEM (10,000,000 units, 8 decimals) | no |
| TapeOut mint fee, per call | 0.01 BEM (1,000,000 units) | no |
| TapeOut tape-out fee | 0.0013 OKB, exactly | no |
| Gas price | 0.02 gwei (20,000,001 wei) | no |
| TapeOut factory | not sealed, owner `0xB3D8…3138` | no |
| BEM price | 0.1026 OKB per BEM, in the BEM / WOKB pool (before the pool's 1% fee) | cheaper than the 0.114 at Gate A |

The deploy script re-reads the three TapeOut fees immediately before sending anything and stops if any
differs from the approved figure.

## What gets deployed, in order

| # | Step | Gas | OKB fee | BEM fee |
|---|---|---|---|---|
| 1 | Deploy `RuleStock` | 2,092,620 | | |
| 2 | Approve BEM for the stock | 46,393 | | |
| 3 | `open()`: create the processor, mint the whole 100,000,000-transistor supply, in one transaction | 1,028,242 | | 0.11 |
| 4 | Tape out "Lowest compliant price" (15 NAND) | 430,483 | 0.002 | |
| 5 | Tape out "Price 60 / Quality 40" (141 NAND) | 744,458 | 0.002 | |
| 6 | Tape out "Quality 70 / Price 30" (133 NAND) | 720,386 | 0.002 | |
| 7 | Tape out "Fastest compliant delivery" (12 NAND) | 352,925 | 0.002 | |
| 8 | Deploy `AwardEngine` | 1,678,433 | | |
| 9 | Deploy `Gavelock` (creates its panel and records contracts too) | 6,756,235 | | |
| | **Total** | **13,850,175 gas = 0.000277 OKB** | **0.008 OKB** | **0.11 BEM** |

Each tape-out fee is TapeOut's 0.0013 plus Gavelock's 0.0007 rule fee. The rule fee goes to the fee address
(see decision 1), so if that is the deploy wallet itself, 0.0028 of the 0.008 comes straight back.

After deployment the script reads everything back from the chain and fails loudly if anything differs:
the processor is registered, the whole supply was minted and nobody can mint more, the mint price is 0,
the stock holds the supply minus the gates burned (99,999,699), every contract is under the size limit,
there is no owner/upgrade/pause function, and each of the four rules returns its definition's truth table
on all 2,048 inputs from the chain.

## The two real demo tenders (after the deployment is verified)

| Item | Gas | OKB |
|---|---|---|
| One full tender: create, one document, one question and answer, 3 sealed bids, 3 openings, 3 panel commits and reveals, award, close, 3 deposit claims | about 4,500,000 | 0.00009 gas + **0.01 tender fee** |
| One Quick Quote: create, 3 quotes, 3 openings, award, 3 deposit claims | about 2,450,000 | 0.00005 gas |

Bid deposits (0.001 OKB each) come back to the bidders. The demo bidders and panel members are fresh
wallets created by the demo script, funded from the deploy wallet; their keys are kept in a gitignored
file. Funding: 3 bidders × 0.003 OKB and 3 panel members × 0.0005 OKB, about 0.0105 OKB, mostly
recoverable.

## What the deploy wallet must hold

| Asset | Amount to hold | Why |
|---|---|---|
| **BEM** | **0.12 BEM** | 0.11 is pulled; 0.01 is margin so a rounding difference in the swap cannot stop the deployment |
| **OKB**, after buying the BEM | **0.045 OKB** | 0.008 rule fees + 0.01 tender fee + about 0.0105 to fund demo wallets + 0.0005 gas + 0.016 margin |
| **OKB**, in total, if the BEM is bought from the same wallet | **about 0.06 OKB** | the above plus about 0.0125 OKB for the BEM |

## Where to swap, and how much

- **Token:** BEM, contract `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`, 8 decimals, on X Layer (chain 196).
  Check this address in whichever swap interface you use: do not trust a token by name.
- **Where it trades:** the BEM / WOKB pool at `0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A` (1% fee tier), which
  holds the deepest BEM liquidity I found (about 2,577 BEM against 205 WOKB). Any X Layer swap interface or
  aggregator that routes OKB to BEM through it will do. I cannot tell you which interface you use or
  recommend one by name.
- **How much:** buy **0.12 BEM**. At 0.1026 OKB per BEM that is about 0.0123 OKB before the 1% pool fee and
  slippage, so expect to pay about **0.0125 to 0.013 OKB**. The pool is shallow (205 WOKB), but 0.12 BEM is a
  tiny trade against it, so the price should not move noticeably. Set a minimum received of 0.115 BEM.
- **From:** the deploy wallet itself, so the BEM arrives where it is needed. I do not execute swaps: this is
  yours to do.

## Decisions I need from you

1. **Fee address.** Who receives the tender fee and the rule fees? Proposal: the deploy wallet, so nothing
   leaves your control during the demos. It is fixed forever at deployment and cannot be changed.
2. **Prices.** Proposal: a full tender costs **0.01 OKB**; a custom rule costs **0.002 OKB** in total
   (TapeOut's 0.0013 plus 0.0007 to the fee address); a Quick Quote and bidding are free. These are
   fixed forever. Say if you want different numbers.
3. **Supply.** Proposal: 100,000,000 transistors. Draining it would take 66,665 maximum-size rules, 86.7 OKB
   in TapeOut fees alone.
4. **Deploy wallet.** A dedicated wallet, funded as above. Put its key in `.env` as `DEPLOY_KEY` (the file is
   gitignored and the script never prints the key). Do not paste the key into a chat or into any tracked file.

On approval I create `packages/contracts/deploy/approved.json` with the exact fees above and the fee
address you choose, and run `node --env-file=.env packages/contracts/scripts/deploy-mainnet.ts` with
`CONFIRM_MAINNET=I_APPROVED_THE_GATE_B_TABLE`. If anything differs from this table at that moment, it stops.

## Not covered by this approval

DeWEB publishing (Gate C). It costs 0.08 OKB to open the site's container and is a dry run only until you
approve it.
