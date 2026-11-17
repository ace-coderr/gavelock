# Gavelock

Tamper-proof tenders and quote requests on X Layer.

Gavelock stops the buyer from cheating: leaked bids, scoring rules changed after the bids arrive, quietly
edited documents, late bids. It does **not** stop suppliers from colluding with each other.

> **Status, 17 November 2026: built and tested on a fork of X Layer; not yet deployed to mainnet.**
> The contract addresses below are empty until the deployment is approved and run. The web app already
> runs and says so wherever it has nothing to show.

- Live site: https://ace-coderr.github.io/gavelock/
- Source: https://github.com/ace-coderr/gavelock
- Licence: MIT

## User value and commercial potential

**Who it is for.** NGOs, cooperatives, companies and DAO grant programmes that buy through tenders and quote
requests, and the bidders, evaluators, donors and auditors who have to trust the result.

**The problem.** In a normal tender the buyer holds all the power after the bids arrive. A friendly bidder can
be tipped off, the scoring rule can be adjusted until the right company wins, a document can be quietly
edited, a late bid can be let in. The people who lose can rarely prove it.

**What Gavelock changes.**

- A bid is encrypted in the bidder's browser to a moment in time. Nobody, including the buyer and Gavelock,
  can read it before the deadline.
- The documents, the scoring rule, the evaluation panel and the deadline are frozen when bidding starts. The
  deadline can never move.
- After the deadline anyone can open any bid. The contract checks it against the commitment made at
  submission.
- The award is computed by calling a public circuit on TapeOut. It is not chosen. Ties resolve the same way for
  everyone. Anyone can re-derive an award in their browser, from the chain alone, on the Verify page.
- A tender can run in minutes: durations are parameters, with a one-minute minimum.

**Revenue.** A flat fee per full tender, paid on chain at creation (proposed: 0.01 OKB). A Quick Quote is
free. Bidding is free. Custom rules pay a small fee on top of TapeOut's own. The fee and its recipient are
fixed at deployment and cannot be changed by anyone.

**Who pays and why.** The buyer pays because a tender nobody can accuse of being rigged is worth more to a
donor, a board or a community than one they must take on trust. Bidders gain because they can see the rule
before they bid and check the result afterwards.

## Innovation

- **The rule is a circuit, and it is load-bearing.** A scoring rule is a small NAND circuit taped out on
  TapeOut. Its input is eleven bits (price band, delivery band, mandatory checklist, two preferred groups,
  panel band), so it has exactly 2,048 possible cases. The Rule Prover reads every one from the chain: a bidder
  can see what the rule does in every situation before bidding. The contract awards by calling the circuit.
- **A rule builder with a proof.** Weights and gates in a form become a truth table, then a circuit, and the
  circuit is checked against the table on all 2,048 inputs before it can be taped out.
- **Time-lock sealing with drand.** Bids are sealed to a public randomness beacon's round. There is no key to
  leak.
- **An abnormally-low-price rule.** One fake bid at an absurd price used to push every real bid into the worst
  price band. A bid below a share of the median compliant price is now flagged, keeps its place, and cannot set
  the price reference for anyone else.
- **A paged, order-independent award.** The ranking is a total order, so the result is identical whoever
  computes it and however the work is split across transactions. This is tested with many page sizes and
  callers.
- **Everything on chain, nothing hidden in logs.** Documents, questions, answers and bid ciphertexts are
  stored as contract code. The Audit Pack (PDF and JSON) is built in the browser and does not depend on a node
  keeping old logs.

## Ecosystem integration

- **TapeOut on X Layer** is the core. Gavelock owns a processor, and every scoring rule is a circuit taped
  out on it. A contract that creates the processor mints its entire transistor supply to itself in one
  transaction, so nobody else can mint, and lets buyers tape out custom rules for OKB alone (they never need
  the TapeOut fee token).
- **drand quicknet** for time-lock encryption (`tlock-js`).
- **X Layer** for everything else: no backend, no server of ours. The site is static and reads the chain
  directly through public nodes.
- **MCP.** `packages/mcp` is a read-only MCP server with five tools: `list_tenders`, `get_tender`,
  `get_rule_truth_table`, `verify_award`, `get_supplier_passport`. An AI assistant can answer "who won, and
  does the award check out?" by reading the chain, with no ability to send a transaction.
- **DeWEB.** The site loads nothing from another origin, so it can be published on chain through TapeOut
  DeWEB. This is a dry run only until the owner approves it.

## Product readiness

| Area | State |
|---|---|
| Contracts | Tender, panel, records, award library, rule stock. 37 unit tests on an in-memory chain and a fork suite against the real TapeOut contracts. No contract has an owner, a pause or an upgrade path. |
| Core library | 78 tests: bid encoding, banding, the rule compiler with exhaustive equivalence, sealing, the reference award. |
| Web app | Tender Board, Tender Studio, Rule Library and Prover, tender pages (Documents, Clarifications, Bid Room, Opening, Panel, Award and Challenge, Audit Pack), Supplier Passport, Buyer Record, Verify. Works on a phone. Fonts bundled locally. |
| MCP | 9 tests including a stdio round trip. |
| Audit | A self-review that found and fixed four real problems: [docs/AUDIT.md](docs/AUDIT.md). |
| Deployment | Rehearsed end to end on a fork with every read-back check passing. Awaiting approval: [docs/GATE-B.md](docs/GATE-B.md). |

### Contracts and circuits

| | Address |
|---|---|
| Gavelock (tenders) | not deployed yet |
| Gavelock processor (TapeOut circuits) | not deployed yet |
| Rule stock | not deployed yet |
| Panel / records / award library | not deployed yet |

| Starter rule | NAND gates | Circuit ID |
|---|---|---|
| Lowest compliant price | 15 | not taped out yet |
| Price 60 / Quality 40 | 141 | not taped out yet |
| Quality 70 / Price 30 | 133 | not taped out yet |
| Fastest compliant delivery (Quick Quote) | 12 | not taped out yet |

## Honest limits

- **Bids are public after opening.** Only the period before the deadline is secret.
- **TapeOut's contracts are upgradeable by their owner.** Today the code that runs a circuit has no owner (its
  beacon's owner is the zero address), but the factory is not sealed and its fees can change. Gavelock's rules
  are flat NAND circuits with no reference to any other circuit, so an existing rule does not depend on the
  factory.
- **A dishonest buyer can still disqualify a bid.** The buyer rules on challenges, and the contract cannot check
  whether a compliance claim is true. Every challenge, ruling and reason is permanent and public, and a bond
  stops anyone burying a buyer in challenges, but this is a deterrent, not a prevention.
- **A buyer can walk away.** A tender can be cancelled with a public reason until the award is final.
- **Several fake low bids can still move the median.** The abnormally-low rule stops one fake bid, not many,
  because wallets are free. A meaningful bid deposit is the buyer's defence.
- **If the drand network stopped, bids could not be opened.** The tender would end with "no bid was opened" and
  deposits would be returned.
- **A wrong seal is found by people, not enforced.** The contract cannot decrypt a ciphertext. The app flags a
  bid sealed to the wrong round or not sealed at all, and it can be challenged.
- **Rule labels are not authoritative.** The Rule Prover, which reads every outcome from the chain, is.
- **A self-review is not an independent audit.**

Full detail: [docs/AUDIT.md](docs/AUDIT.md) and [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Run it

```
npm install
npm run dev          # the web app
npm test             # core, web and MCP tests
npm run test:fork    # contract tests against a fork of X Layer (slow; needs network access)
node packages/mcp/src/cli.ts   # the MCP server on stdio
```

Node 24 or newer.

## Layout

```
packages/core        shared logic: rules, compiler, bids, banding, award, sealing
packages/contracts   Solidity, tests, deployment plan and rehearsal
packages/mcp         the read-only MCP server
web                  the static web app
docs                 protocol findings, audit, deployment plan, status
spike                the Task 0 chain checks (standalone)
```
