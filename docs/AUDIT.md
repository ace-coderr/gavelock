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

# Audit of the UI pass (17 November 2026)

The Palazzo-style redesign: warm dark theme, display serif, the pinned stage wheel, the sticky split
sections, the frosted glass over the bids, tilted cards, chips and switches, panel seats and drag rows. Every
check below was run in a real browser (the built site served from localhost) unless it says otherwise.

## Found and fixed

| # | Finding | Fix |
|---|---|---|
| 1 | The built site was 1,005,954 bytes, over the 1 MB budget. | The generated ABIs drop `internalType` and events the app never reads (65 KB to 26 KB); react-router, a large library for what is a tiny hash router, was replaced by a 130-line router with its own tests. The site is now **970,824 bytes in 9 files**. |
| 2 | The footer wheel's disc escaped its container and made the page wider than the screen (a horizontal scrollbar). | The container is now positioned, so the disc is clipped. |
| 3 | While scrolling quickly, the stage title and text did not change until scrolling paused, because every stage change restarted the swap timer. | One blur-out, then show whichever stage is current: a fast scroll can no longer starve the text. |
| 4 | Keyboard and button steps on the wheel computed their target from the displayed stage, which had not moved yet, and smooth page-scrolling was restarted by the next key. Three presses did not move three stages. | Steps continue from the last requested stage; the page jumps and the wheel eases by itself. Verified with real key presses: three Right arrows went from stage 1 to 4, two Left arrows back to 2. |
| 5 | The hero wheel and the footer wheel had the same accessible name ("Tender stage"). | "Tender stage, hero wheel" and "Tender stage, explainer wheel". |
| 6 | One colour pair failed WCAG 4.5:1: the faint label colour on a raised receipt card (4.47:1). | The token was lightened (5.10:1). `web/scripts/contrast.mjs` computes every pair from `tokens.css` and fails if one drops below its minimum; all 17 pairs pass (the lowest text pair is 5.10:1, body text is 15.7:1). |
| 7 | Activating "Clear the glass" with the keyboard disabled the button it was on, so keyboard focus was dropped. | Focus moves to "Frost it again". Verified: Tab reaches the button, Enter clears the glass, and the frosted copy contributes no focusable controls (it is inert and hidden from assistive technology). |
| 8 | The scroll position was published as a CSS variable on the root element, which invalidates the style of every element on the page on every frame. | It is set only on the floating cards. |
| 9 | The tender cards on the Board did not link to their tender page. | The title now links to `/t/<id>`. |
| 10 | A failed node request read "HTTP request failed.." with two full stops. | Trailing full stop removed. |

## Checked and found sound

- **Layout.** No horizontal page scroll at 375 px (phone), 768 px (tablet) or 1280 px (desktop) on the Board,
  New tender, Rules, Rule Prover, Verify, How it works, tender, Supplier, Buyer and not-found pages.
- **Reduced motion.** With `prefers-reduced-motion: reduce` the hero is not pinned (both wheels run in their
  button-driven mode), everything that blurs in is visible at once, and the glass is not drawn: content is simply
  shown. The motion tokens are zero as well, so no transition runs.
- **Empty states.** With no tender on chain the Board says so, labels the wheel as an explainer, and shows no
  tender cards. The Studio shows every rule struck through with the reason ("The processor is not deployed yet").
- **RPC failure.** With every node request failing, the network panel says "Node unreachable", that no figures
  have loaded, offers a retry, and the rest of the page keeps working.
- **No other origin.** The build contains no external script, stylesheet, font or image reference (checked by a
  scan of the output and, in CI, by the deploy workflow). At run time the page talks only to X Layer nodes, and to
  drand when a bid is sealed or opened.
- **Content is real.** The wheel marks a real tender's stage when one exists and otherwise says it is an
  explainer. The seal and the rule grid are drawn from the current drand round and from every outcome of a rule
  computed in the browser; the floating cards, receipts and the bids list appear only with data read from the chain.

## Not verified

- **Frame rate.** The goal is 60 fps on a mid-range phone. It could not be measured: the browser pane used for
  testing was hidden, and a hidden pane pauses `requestAnimationFrame`. By design the per-frame work is small
  (one scroll read, one attribute write on the wheel, one variable write per floating card), and no animation
  library is used, but this is reasoning, not a measurement.
- **Real touch.** The glass wipe and the wheel drag use pointer events with `touch-action` set, which is the
  standard route for touch, but they were exercised here with mouse events only. A phone test is still owed.
- **Live data on the tender page.** Its bids split, rule-grid marker, receipts, glass over real bids and panel seats were
  exercised with sample content in a throw-away page that was not committed; with real data they are first seen
  after the contracts are deployed.
- **Frame-level contrast of the glass** and decorative hairlines were not measured; text on them is above 15:1.
