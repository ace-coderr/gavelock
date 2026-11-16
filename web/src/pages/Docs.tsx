import { DEPLOYMENT, QUICKNET, RULE_SHAPE, isDeployed } from '@gavelock/core';

export function Docs() {
  const deployed = isDeployed(DEPLOYMENT);

  return (
    <div className="stack stagger">
      <header className="page__head">
        <span className="eyebrow">How it works</span>
        <h1 className="title">A tender the buyer cannot tilt.</h1>
        <p className="lede">
          Gavelock is for organisations that buy through tenders and quote requests, and for the bidders, evaluators,
          donors and auditors who need to trust the result.
        </p>
      </header>

      {!deployed && (
        <p className="notice">
          Status: in development. The tender contract is not on X Layer mainnet yet, so nothing described here can be
          used today. This page describes how the protocol is designed to work.
        </p>
      )}

      <article className="prose">
        <section>
          <h2>What it stops</h2>
          <ul>
            <li>
              <strong>Leaked bids.</strong> A bid is encrypted in the bidder's browser to a moment in time. Nobody,
              including the buyer and Gavelock, can read it before the deadline.
            </li>
            <li>
              <strong>Rules changed after bids arrive.</strong> The scoring rule, the documents, the panel and the
              deadline freeze when bidding starts.
            </li>
            <li>
              <strong>Quietly edited documents.</strong> Every document version is stored on chain with its SHA-256.
            </li>
            <li>
              <strong>Late bids.</strong> The contract refuses them. The deadline can never move.
            </li>
          </ul>
          <p>
            It does not claim to stop suppliers colluding with each other. It removes the buyer's ability to cheat.
          </p>
        </section>

        <section>
          <h2>The life of a tender</h2>
          <ol>
            <li>
              <strong>Published.</strong> The buyer posts the documents, the checklist, the scoring rule and the dates.
            </li>
            <li>
              <strong>Clarifications.</strong> Anyone asks questions on chain; the buyer answers on chain and may issue
              numbered addenda.
            </li>
            <li>
              <strong>Bidding.</strong> Everything freezes. Bidders submit sealed bids with a deposit.
            </li>
            <li>
              <strong>Opening.</strong> After the deadline anyone can unseal any bid. The contract checks each one
              against the commitment made when it was submitted.
            </li>
            <li>
              <strong>Evaluation.</strong> Each panel member commits a hidden score, then reveals it. The contract
              takes the median.
            </li>
            <li>
              <strong>Award.</strong> Anyone can trigger it. The contract scores every bid with the tender's rule
              circuit and ranks them. The buyer has no say.
            </li>
            <li>
              <strong>Standstill.</strong> Anyone can challenge a false compliance claim or a seal mismatch. The buyer
              must rule on chain with a reason; an upheld challenge recomputes the award.
            </li>
            <li>
              <strong>Final.</strong> Deposits are returned.
            </li>
          </ol>
          <p>A tender can also be cancelled, with a public reason, and deposits returned.</p>
        </section>

        <section>
          <h2>Sealed until the deadline</h2>
          <p>
            Bids are locked with time-lock encryption against drand, a public randomness beacon run by independent
            organisations. It publishes a new value every {QUICKNET.period} seconds. A bid sealed to the round at the
            deadline can be opened by anyone once that round exists, and by nobody before. There is no key for anyone
            to leak.
          </p>
        </section>

        <section>
          <h2>The rule is a circuit</h2>
          <p>
            A scoring rule is a small logic circuit taped out on X Layer through TapeOut. It takes{' '}
            {RULE_SHAPE.inputs} bits describing a bid (price band, delivery band, compliance, panel band) and returns
            whether the bid is eligible and its score.
          </p>
          <p>
            Because the input is only {RULE_SHAPE.inputs} bits, there are exactly {(1 << RULE_SHAPE.inputs).toLocaleString('en-US')}{' '}
            possible cases. Anyone can read every one of them from the chain and see what the rule does in each, before
            deciding to bid.
          </p>
        </section>

        <section>
          <h2>Honest limits</h2>
          <ul>
            <li>After the opening, bids are public. Only the period before the deadline is secret.</li>
            <li>
              If drand stopped publishing, sealed bids could not be opened and the tender would not complete.
            </li>
            <li>
              The circuits run on TapeOut's contracts. The code that evaluates them currently has no owner who could
              replace it; the Tender Board shows a live check of that.
            </li>
          </ul>
        </section>
      </article>
    </div>
  );
}
