# Gavelock: submission for X Layer TapeOut Accelerate

**One line.** Tamper-proof tenders and quote requests: bids sealed until the deadline, rules frozen before the
first bid, and the award computed by a public circuit on TapeOut instead of chosen by the buyer.

- Live site: https://ace-coderr.github.io/gavelock/
- Source (MIT): https://github.com/ace-coderr/gavelock
- Built by ace: https://x.com/_ace_won

## Deployment status (17 November 2026)

Built and tested on a fork of X Layer mainnet. **Not yet deployed to mainnet**: it waits for the owner's
approval of the cost table in `docs/GATE-B.md`. These fields are filled in the day it is deployed:

| Field | Value |
|---|---|
| Gavelock processor | not deployed yet |
| Rule circuit IDs | not taped out yet |
| Tender contract | not deployed yet |
| Real tenders | none yet (one full tender and one Quick Quote are planned) |
| DeWEB name | not published yet (dry run done: `docs/GATE-C.md`) |

## How it meets each criterion

**User value and commercial potential.** Buyers who must prove a tender was fair (NGOs, cooperatives,
companies, DAO grant programmes) get a tender nobody can accuse of being rigged; bidders see the rule before
they bid and check the result after. Revenue is a flat on-chain fee per full tender; Quick Quote and bidding
are free. See the README.

**Innovation.** The scoring rule is a circuit with only 2,048 possible inputs, so every outcome can be read from
the chain before bidding. A rule builder turns a weights-and-gates form into a circuit and proves it equal to
the table. Bids use time-lock encryption. An abnormally-low-price rule stops one fake bid flattening everyone's
price band. The award is a total order, so paged computation gives the same result for everyone.

**Ecosystem integration.** TapeOut is load-bearing: Gavelock owns a processor, every rule is taped out on it,
and `finalize` calls `eval` on it. A rule-stock contract mints the whole transistor supply to itself in one
transaction so custom rules cost buyers only OKB. drand for sealing. A read-only MCP server. The site is
DeWEB-ready (no external origin).

**Product readiness.** 78 core tests, 37 contract unit tests, 9 MCP tests, and 61 fork tests against the real
TapeOut contracts, all passing. A full deployment rehearsal on the fork with read-back verification. A
documented self-audit with four fixes. A working web app on a phone. See `docs/AUDIT.md`.

## Try it

```
git clone https://github.com/ace-coderr/gavelock && cd gavelock
npm install
npm run dev        # http://localhost:5173
npm test
```

The site's Rules page needs no wallet: the rule builder compiles and proves a rule in the browser. Pages that
read tenders show an honest "not deployed yet" until the contracts are live.

## Honest limits

Bids are public after opening. TapeOut's contracts are upgradeable by their owner. A dishonest buyer can still
disqualify a bid through the challenge process, and can cancel. Several fake low bids can move the median. A
self-review is not an independent audit. Full list: README and `docs/AUDIT.md`.
