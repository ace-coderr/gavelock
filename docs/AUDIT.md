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

# Audit of the wheel rework (18 November 2026)

The two wheels became one: a single fixed dial that is large in the pinned hero, docks as a small dial while
the reader scrolls, and returns to full size above the footer, in its final state with the lock open. It has a
fixed needle, a spring with friction, a tick at every stage, momentum after a drag, and a picture inside for each
stage. The two inline headline pictures were replaced and the footer was rewritten.

## Found and fixed during the rework

| # | Finding | Fix |
|---|---|---|
| 1 | The hero must sit below the sticky navbar. | The hero's pinned area is exactly the viewport minus the navbar (`100svh - nav`); the dial is placed from the measured slot, not from guesses. Measured fits below. |
| 2 | On a phone the dial was cut off by the screen edge because the copy was too tall. | The phone copy is compact (no big numeral, shorter controls); the dial now fits whole. |
| 3 | On a tablet in portrait the two-column hero left a dial about 170 px wide. | Up to 1023 px the copy sits above the dial, which keeps its size. |
| 4 | At the end of the page the footer pushed the final dial partly above the screen, and the dial overlapped the navbar links. | The final slot is sized from the viewport so the whole dial is visible when the page ends (checked at 1366 by 768 and 375 by 667); the dial sits under the navbar except while docked. |
| 5 | The docked dial on a phone would cover content. | On a phone it docks inside the navbar, which reserves room for it, so it covers nothing. On wider screens it docks bottom right. |
| 6 | The first stage picture sampled every 16th outcome, so it drew stripes. | The sample steps through different input bits, so it shows a real spread of outcomes. |
| 7 | New colours (captions, hints, footer text) were not in the contrast check. | Six pairs added to `web/scripts/contrast.mjs`; all 23 pairs pass (lowest 5.10:1). |

## Verified

| Check | Result |
|---|---|
| Hero below the navbar, dial whole | Checked by measuring and with screenshots at 1920x1080, 1440x900, 1366x768, 768x1024 and 375x667. No horizontal scroll at any of them. |
| One wheel | One `.dial` element in the page; the old compact wheel and its component are deleted. It moves hero, dock, final by one scroll-driven transform; scrolling back reverses it. Clicking the docked dial scrolls to the top. |
| Keyboard | The dial is a slider in the hero: Right/Down and Left/Up step one stage, Home/End jump. Three Right presses went from stage 1 to 4 and two Left presses back to 2. Docked, it is a button (Enter or Space returns to the top). In the final slot it is a labelled image. The Back, Next stage and Sound buttons are ordinary tab stops. |
| Reduced motion | The hero is not pinned, there is no docking and nothing animates (the pictures show their finished state). The dial sits in the hero, then in the final slot, and is hidden in between. Back/Next turned it: three Next presses reached stage 4, one Left press stage 3. |
| Frame rate (desktop) | With the browser pane visible, scrolling the whole pinned hero (180 scroll steps in 3 s) gave 180 frames, average 16.7 ms, slowest 16.9 ms, none over 20 ms. |
| Sound | Off by default. The audio context is created only by the click on the Sound button; nothing plays on load. |
| Bundle | 998,839 bytes in 7 files, under 1 MB (but with little room left). |
| External origins | None in `index.html` or the CSS. No fonts, scripts or images from another origin. The footer's repository and explorer links are ordinary links, not loaded resources. |
| Typecheck, tests | Typecheck passes; 11 web tests pass. |
| Footer | Product name, one line, How it works / Rules / Verify, repository, explorer links to the three contracts once deployed (until then it says they are not deployed), and the limits note. No builder byline anywhere in the site, README or submission document. |

## Not verified

- **Frame rate on a phone.** Measured only on this desktop. The per-frame work is one transform write, two attribute writes and a few rect reads; but a mid-range phone was not tried.
- **Real touch.** Drag with a finger, the momentum after a flick and a tap on a numeral use pointer events with `touch-action: pan-y` on the dial; they were exercised here with a mouse only.
- **Sound.** The tick and thud are synthesised; they were built but not heard in this session.
- **Live data.** With no tender on chain the dial says it is an explainer. Its live marker (a dot on the stage of the newest tender) is first seen after the contracts are deployed.
- **The stage pictures in motion on every size.** Each was seen at desktop size (stage VI, the lock, the first stage) and the phone size (first and final stage); the quick scroll through all eight at phone size was not recorded.
- **Hint bubble on a phone.** The numeral hint appears on tap; it was not captured in a screenshot on a phone.

# Bundle reduction attempt (18 November 2026)

Goal: under 700 KB without removing a feature. **Not reached.** Before and after, in bytes:

| | Before | After |
|---|---|---|
| Whole `dist` | 998,839 | 999,655 |
| Loaded on first visit (HTML, CSS, fonts, main script) | 838,136 | 838,136 |
| Main script | 712,622 | 712,421 |
| Seal chunk (time-lock code, loaded when a bid is sealed or opened) | 156,481 | 156,481 |
| Fonts (Inter 48,256; Instrument Serif 21,032 and 22,128) | 91,416 | 91,416 |
| CSS | 33,311 | 33,311 |

What was measured: bytes by package in the main script are viem 214 KB, react-dom 207 KB, the app and the
shared core about 130 KB, ox 38 KB (inside viem), noble curves 25 KB, abitype 14 KB. The seal chunk is mostly
noble curves (62 KB), a Buffer shim (25 KB) and tlock-js and its drand client (30 KB).

What was done: viem's text-ABI parser was replaced by JSON ABIs; the dial's sound code is now a separate chunk fetched
the first time Sound is switched on (checked: not requested before the click, requested after); the duplicate
digit helper in the dial scenes was removed; the unused `@fontsource-variable/inter` dependency (the font files
are local copies) was removed. These save about 200 bytes in the main script, because viem still ships the
parser for its own use. The fonts cannot shrink further without a font tool: both are already Latin-only and the
site uses only weights 400, 500 and 600 of Inter, but Inter is one variable file that cannot be cut by weight
without fonttools, which is not installed.

What would be needed: React's DOM library alone is 207 KB. Swapping it for Preact (about 13 KB, same hooks and
components through a compatibility alias) would save roughly 190 KB, but it adds two new packages, so it needs
the owner's approval; even then the total is about 810 KB, so 700 KB would also need viem replaced by a small
hand-written client for the dozen calls the app makes. Neither was done.

# Large wheel and headline pictures (18 November 2026)

## What changed

- **The hero dial is large again.** On screens 1024 px and wider the dial is about 1.1 to 1.25 times the viewport
  height, centred vertically in the pinned area, and bleeds off the top, right and bottom. Its active stage now sits at
  the **left** edge of the ring, next to the copy, with the needle and the numeral upright, so the crop only ever
  cuts the far side of the ring. Under 1024 px the copy is above the dial, the active stage sits at the **top**, and the dial
  bleeds off the bottom and sides. The ring turns smoothly to the top as it docks, and the docked and final states are unchanged.
- **Sizing rule.** The radius is the smaller of 0.625 of the viewport height and what leaves the whole central
  picture (about 0.56 of the radius either side of the centre) on screen, clear of the copy. The picture, needle and
  active numeral can therefore never be cropped; only the far ring can.
- **Navbar.** It is now solid (no transparency), and the pinned hero starts at the navbar's bottom edge. The dial sits under the navbar,
  except when docked.
- **Headline pictures.** Both are finished by default: the padlock is closed and the rule table full. The animation
  only starts from an earlier state when a picture scrolls into view and ends on the finished state, so without script, with
  reduced motion, with a slow page or when scrolled back it rests finished. Each pill is sized to its content, 1.2 times the
  headline's text size, aligned to the text. The rule pill is a table of five inputs (11 bits each) and the score the rule
  gives each, and was enlarged rather than shrunk. Both captions sit in one row under the headline, in one style, each starting with the
  picture's name; on a phone they are hidden until the picture is tapped.

## Measured

| Check | Result |
|---|---|
| Hero fit, screenshots after the change | 1920x1080, 1440x900, 1366x768, 768x1024, 375x667: needle, active numeral and the whole central picture on screen, dial cropped at the far side, navbar not overlapped. Before screenshots were taken at 1920, 1440 and 1366 (the earlier small dial); the 768 and 375 "before" were the previous pass. |
| First attempt at 768x1024 | The scene caption was cut at the bottom; the allowance for the caption was widened and re-checked (fixed). |
| Headline pictures, desktop (1440, text 88 px) | Pills 106 px high (1.2 em), grid pill 342x106, lock pill 118x106; headline bottom 1846, captions row at 1870: no overlap; both captions shown; the shackle rests with no transform (closed). |
| Headline pictures, phone (375) | Screenshot: lock closed, table readable, pills fit in the line; captions hidden until tapped; after tapping the lock, its caption appears under the headline. |
| Typecheck, 11 web tests, contrast (23 pairs) | Pass. |
| Bundle | 1,000,458 bytes in 8 files (initial load 838,939). This is 0.95 MiB; it is a few hundred bytes over 1,000,000, so it is not "under 1 MB" if 1 MB means a million bytes. |

## Not verified

- The browser pane stopped drawing and running animation frames during the second half of this pass, so after the
  geometry change I did **not** re-run: the scroll through the pinned hero, the dock and final transitions, drag with
  momentum, and the frame-rate measurement. The code for those paths is unchanged except that the dial now also rotates
  between its left and top orientations (`-90` degrees times one minus the dock or final progress), which should be seen moving.
- A desktop screenshot of the finished headline pictures was not captured (the pane failed to draw); the desktop figures above
  are measured from the page.
- Keyboard and reduced motion were not repeated after this change.
- Nothing was run on a real phone.

## React replaced by Preact (18 November 2026, approved by the owner)

The components are unchanged: they still import from `react`, and the Vite preset maps that to Preact's React-compatibility layer.
`react`, `react-dom` and `@vitejs/plugin-react` were removed; `preact` and `@preact/preset-vite` were added.

| | Before | After |
|---|---|---|
| Whole `dist` | 1,000,458 | 787,130 |
| Loaded on first visit (HTML, CSS, fonts, main script) | 838,939 | 625,611 |
| Main script | 712,421 | 500,449 |

The first-visit load is now under 700 KB; the whole `dist` (which includes the time-lock chunk fetched only when a bid is
sealed or opened) is 787 KB, so the 700 KB goal is met for what a visitor loads but not for the whole folder. Reaching it for the
whole folder would need viem replaced as well (viem is 214 KB of the main script).

Checked after the swap: typecheck and the 11 web tests pass; every route renders without a script error (home, new tender, rules,
rule page, verify, docs, tender, supplier, buyer, not found); on the home page three Right presses on the dial went from stage 1
to 4 and two Left presses back to 2, the page docked the dial into the navbar on a narrow viewport and the final slot took it back
(the pane does not deliver scroll events or animation frames while hidden, so scroll events were fired by hand); the split list responds
to click and hover; the sound toggle fetches its chunk on first click; the new-tender form takes typing and its switch toggles. Not checked: the
frosted-glass wipe and the panel seats (they need a tender on chain), a drag with the mouse, frame rate after the swap, and a real phone.
