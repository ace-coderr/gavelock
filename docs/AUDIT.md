# Audit pass (Task 6)

Written 17 November 2026, by the author, against the contracts at the commit named in the last section.
This is a self-review: the same person wrote and attacked the code. It found real problems and fixed
them, but it is not independent assurance, and it does not replace a review by someone else before
real money is at stake.

Everything below is checked by a test that runs. `npm test` in `packages/contracts` runs the fast
tests on an in-memory chain (37 tests). `npm run test:fork -w @gavelock/contracts` runs the same
system against the real TapeOut contracts on a fork of X Layer.

## Found and fixed

| # | Finding | Why it mattered | Fix | Test |
|---|---|---|---|---|
| 1 | Anyone could file unlimited challenges for the price of gas. | The buyer must rule on each and a tender cannot close with one open. A griefer could bury a buyer in thousands of challenges, or let them go unruled until `cancelStalled` ended a legitimate tender. | A challenge carries a bond equal to the bid deposit. Upheld, or the tender ends first: it goes back to the challenger. Rejected: it goes to the fee address, **never to the buyer**, so the buyer gains nothing by rejecting. | `audit.test.ts`: exact bond, upheld, rejected, tender ended first, spam cost |
| 2 | Unlimited bids at any deposit, including zero. | Every panel member must send one score per bid, so a tender with tens of thousands of free junk bids could not be evaluated. | At most 200 bids per tender. A deposit of at least 0.001 OKB, enforced when the tender is created. | `audit.test.ts`: 200 accepted, the 201st refused; deposit one wei short refused |
| 3 | A buyer who left a challenge unruled still collected the deposits of unopened bids when `cancelStalled` ended the tender. | The party at fault was paid. | `cancelStalled` marks the tender as stalled. A stalled tender forfeits nothing to the buyer; every deposit goes back to its bidder. | `audit.test.ts`: stalled tender vs. the same tender closed normally |
| 4 | The app did not say when a bid was sealed to the wrong round. | A bid sealed to a *later* drand round cannot be opened by others at the deadline. Its owner then sees every other bid and chooses whether to open theirs or forfeit the deposit. | The Opening tab reads each ciphertext's header at any time and flags a wrong round or non-ciphertext in red, with the route to challenge it as a seal mismatch. | `packages/core` seal tests (header reading) |

## Checked and found sound

- **Reentrancy and pull payments.** Every payout (`claimDeposit`, `claimBond`, `withdrawFees`) sets its
  "paid" flag before the call and is `nonReentrant`. `ReentrantBidder` is a contract that, when paid,
  tries to re-enter `claimDeposit`, `claimBond` and `withdrawFees`: it is paid once and every re-entry
  reverts. A contract that refuses payment only blocks its own deposit; everyone else is paid and the
  refuser can still collect later. The fee address is paid by pull as well.
- **Phase skipping.** Each action checks the timestamp window it belongs to: bids before the deadline,
  opening in the opening window, panel commit and reveal in theirs, `finalize` only after the last
  window (or during a recompute), challenges only while an award stands inside the standstill,
  `close` only after the standstill with no challenge open. Documents, questions and answers stop the
  moment bidding starts, read from the tender contract by the records contract.
- **Late and replayed bids.** The deadline is stored once and never moves. A bid at the deadline second
  is refused. One bid per address. A commitment copied into another tender, or submitted by another
  address, cannot be opened: it binds chain id, contract, tender id and bidder.
- **Commitment collisions.** `abi.encode` length-prefixes the note, so no two different bids share an
  encoding. Salts are 32 random bytes.
- **Opening someone else's bid wrongly.** Anyone may open any bid, but only with exactly the committed
  values; any change of price, delivery, claims, note or salt reverts. A stranger can open a bid on its
  owner's behalf and cannot alter it.
- **Panel non-reveal.** A member who does not reveal is left out of the median. The tender ends with a
  public reason if fewer than the quorum reveal. A score above 100 cannot be revealed.
- **Ties.** The ranking is a total order: score, then lower price, then lower bid index. The winner
  does not depend on the order or grouping of bids processed. Tested with seven page-size plans and
  several callers on random tenders, on the in-memory chain and against real circuits on the fork.
- **Eval reverting or returning an unexpected width.** The circuit is called with a fixed gas amount.
  A revert, a wrong length, a value with bits above the fifth, a burn of all its gas, or something that
  is not ABI-encoded bytes ends the tender with a public reason and releases every deposit. Too little
  gas supplied by the *caller* reverts the call instead, so a healthy circuit is never blamed.
- **Zero or one bid.** No opened bid: the tender ends itself. One bid: it is awarded. A Quick Quote needs
  three opened quotes.
- **Cancelled tenders and refunds.** A tender cancelled before the opening window ends refunds
  everyone. If nothing could be opened, nobody forfeits a deposit.
- **Integer arithmetic.** Prices are compared by cross-multiplication in 256 bits, never divided, so a
  one-unit difference on a 2^127 price is seen. Medians use integer division rounded down.
- **No admin.** No contract has an owner, a pause, a fee setter or an upgrade path (checked by a test
  that looks for the function names). The fee and its recipient are immutable.
- **Contract size.** Gavelock is 20,220 bytes of 24,576. AwardEngine 7,517.
- **Rule stock.** Nobody can mint after `open()`: the whole supply is minted to the stock in one
  transaction and the supply cap is shared by both transistor types. The stock has no function that
  moves a transistor. A front-runner who calls `open()` first pays the fee token themselves.

## Honest limits (not fixed, and not fixable in these contracts)

These belong in the README.

1. **A dishonest buyer can still disqualify a bid.** The buyer rules on challenges. A buyer can file a
   challenge from a second wallet against any opened bid, then "uphold" it with a reason. The contract
   cannot check whether a compliance claim is true. What stops this is publicity: every challenge, ruling
   and reason is permanent and shown on the Buyer Record, and an upheld ruling restarts the award through
   the same public path. It is a deterrent, not a prevention.
2. **A buyer can walk away.** `cancel` is allowed until the award is final, with a public reason. Bidders
   get their deposits back but the tender is lost. The same holds if the buyer simply never rules
   (anyone can then end the tender after two standstill periods).
3. **Several fake low bids can still move the median** (see `PROTOCOL.md` section 8). Wallets are free.
4. **Selective opening.** A bid that is sealed correctly is committed: nobody can change it. But opening
   needs the owner or anyone who decrypts it, so a bidder can try to avoid being opened at all. Anyone can
   decrypt a correctly sealed bid at the deadline, so this only works for a bid sealed to the wrong round or
   not sealed at all, which the app flags (finding 4) and which can be challenged. The contract cannot verify
   a ciphertext, because decrypting needs the drand signature, so a wrong seal is found by people, not enforced.
5. **Bids are public after opening.** Only the period before the deadline is secret.
6. **drand.** If the network stopped, bids could not be opened. The tender would end with "no bid was
   opened" and deposits would be returned.
7. **TapeOut.** The code that runs a rule's `eval` has no owner today (the beacon's owner is the zero
   address), but the factory is upgradeable and its fees can change. Gavelock's rules are flat NAND
   netlists with no reference to any other circuit, so an existing rule does not depend on the factory.
8. **Rule labels are not authoritative.** Anyone can tape out a rule through the stock and name it
   "Lowest compliant price". The Rule Prover, which reads every outcome from the chain, is the source of
   truth, and the Rule Library shows who taped each rule out.
9. **Review time.** A buyer can post the last document a moment before bidding starts. The schedule is
   visible and fixed at creation, so bidders can see how long they will have.
10. **Not an independent audit.** See the top of this file.

## Web app

- **RPC failure.** Every page that reads the chain shows a loading state, an error with a retry button,
  and, if an earlier read succeeded, keeps showing that data next to the error. The node list falls
  back from one public node to another. The truth-table reader reports exactly which inputs the chain
  did not answer, and the Verify page refuses to call an award verified unless every input answered.
- **Transactions.** A transaction is only sent from a button press. The fee estimate is shown first,
  then the wallet signature, then pending, confirmed or failed with the explorer link. A call the node
  would reject is reported with its reason before anything is signed.
- **Mobile.** Found and fixed: the navbar grew to five links as pages were added and made every page
  566 px wide on a 375 px phone. The links now scroll inside the bar. Re-checked at 375 px: no
  horizontal page scroll on the Board, New tender, Rules, Rule Prover, Verify, How it works, tender,
  Supplier, Buyer and not-found pages. Tables sit in a scrolling container, never widening the page.
  Not yet checkable: the tender page's tabs and the Studio with live data, because the contracts are not
  deployed; they are measured again after Gate B.
- **Secrets.** A bid's salt and a panel member's scores are kept only in that browser's local storage,
  and the page tells the user so and offers a download. Losing them means the bid cannot be opened by its
  owner, but anyone else can still open a correctly sealed bid.
