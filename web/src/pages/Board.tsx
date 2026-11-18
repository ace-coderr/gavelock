import { useMemo, useState } from 'react';
import { Link } from '../lib/router.tsx';
import { DEPLOYMENT, STARTER_RULES, isDeployed, latestRoundAt, truthTable } from '@gavelock/core';
import { PicHeadline } from '../components/HeadlinePics.tsx';
import { LandingWheel, WheelFinalSlot } from '../components/LandingWheel.tsx';
import { RuleGridPic, SealPic } from '../components/Pictures.tsx';
import { NetworkPanel } from '../components/NetworkPanel.tsx';
import { Reveal } from '../components/Reveal.tsx';
import { NumberCard } from '../components/Receipt.tsx';
import { SplitSection, type SplitRow } from '../components/SplitSection.tsx';
import { TenderList } from '../components/TenderList.tsx';
import { formatInteger } from '../lib/format.ts';
import { STAGES, STAGE_TEXT } from '../lib/stages.ts';
import { listTenders } from '../lib/tenders.ts';
import { useAsync } from '../lib/useAsync.ts';

// The explainer rule: computed here, in the browser, from its definition in the core library.
const EXPLAINER = STARTER_RULES[1]!;
const explainerWords = Array.from(truthTable(EXPLAINER.spec));

export function Board() {
  const deployed = isDeployed(DEPLOYMENT);
  const latest = useAsync(() => (deployed ? listTenders(0, 1) : Promise.resolve({ total: 0n, items: [] })), []);
  const tender = latest.data?.items[0] ?? null;
  // The current drand round, from the clock: a real value that changes every three seconds.
  const round = useMemo(() => latestRoundAt(Math.floor(Date.now() / 1000)), []);
  const [sectionStage, setSectionStage] = useState(0);

  const details: Record<(typeof STAGES)[number], React.ReactNode> = {
    Published: <p>The buyer posts the documents, the checklist, the scoring rule and the dates. Each document is stored on chain with its SHA-256.</p>,
    Clarifications: <p>Anyone asks; the buyer answers on chain. New document versions are numbered, never edited.</p>,
    Bidding: (
      <>
        <div style={{ height: '4rem', maxWidth: '10rem' }}>
          <SealPic seed={round} label={`A seal drawn from the current drand round, ${round}`} />
        </div>
        <p>A bid is a 32-byte commitment and a time-locked ciphertext, plus a deposit. Everything else is frozen: documents, rule, panel, deadline.</p>
      </>
    ),
    Opening: <p>Once drand round {formatInteger(round)} and later rounds exist, anyone can decrypt any bid. The contract checks it against the commitment, so a bid cannot be changed after it is sealed.</p>,
    Evaluation: (
      <>
        <div style={{ height: '8rem', maxWidth: '16rem' }}>
          <RuleGridPic words={explainerWords} label={`Every outcome of the rule ${EXPLAINER.name}: 2,048 cells`} />
        </div>
        <p>
          A rule sees eleven bits and answers eligible or not, with a score. This is all 2,048 cases of “{EXPLAINER.name}”, computed in your browser from its definition. The panel commits hidden scores, then reveals them.
        </p>
      </>
    ),
    Awarded: <p>Anyone can compute the award. The contract calls the rule on every bid and ranks them: higher score, then lower price, then the earlier bid. The buyer has no say.</p>,
    Standstill: <p>Anyone can challenge a false claim or a bad seal, with a bond. The buyer must rule on chain with a reason; an upheld challenge restarts the award.</p>,
    Final: <p>The award is final and deposits can be claimed. Everything that happened can be exported as an Audit Pack and re-derived on the Verify page.</p>,
  };
  const rows: SplitRow[] = STAGES.map((s) => ({ key: s, name: s, sub: STAGE_TEXT[s], detail: details[s] }));

  return (
    <>
      <LandingWheel live={tender ? { id: tender.id, phase: tender.phase } : null} sectionStage={sectionStage} data={{ words: explainerWords as number[], round }} />

      <section className="band" aria-labelledby="run-title">
        <div className="container">
          <SplitSection
            title={
              <span id="run-title">
                How a tender <em>runs</em>
              </span>
            }
            side={
              tender ? (
                <dl className="facts" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="fact"><dt className="fact__label">Latest tender</dt><dd className="fact__value"><Link to={`/t/${tender.id}`}>{tender.title ?? `Tender ${tender.id}`}</Link></dd></div>
                  <div className="fact"><dt className="fact__label">Deadline</dt><dd className="fact__value">{new Date(tender.deadline * 1000).toLocaleString()}</dd></div>
                  <div className="fact"><dt className="fact__label">Rule circuit</dt><dd className="fact__value mono">#{tender.ruleId}</dd></div>
                  <div className="fact"><dt className="fact__label">Deposit</dt><dd className="fact__value mono">{tender.bidDeposit.toString()} wei</dd></div>
                </dl>
              ) : (
                <dl className="facts" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="fact"><dt className="fact__label">Deadline</dt><dd className="fact__value">Fixed for ever when bidding starts</dd></div>
                  <div className="fact"><dt className="fact__label">Rule</dt><dd className="fact__value">A circuit with 2,048 possible cases</dd></div>
                  <div className="fact"><dt className="fact__label">Deposit</dt><dd className="fact__value">Set by the buyer, at least 0.001 OKB</dd></div>
                </dl>
              )
            }
            rows={rows}
            onActive={setSectionStage}
          />
        </div>
      </section>

      <section className="band" aria-labelledby="pics-title">
        <div className="container stack">
          <PicHeadline words={explainerWords} />
          <Reveal as="p" className="lede">
            Both pictures play from real values: the rows come from every outcome of a rule, computed in your browser, and the dial above is drawn from the same rule and the current drand round.
          </Reveal>
          {tender ? (
            <div className="floats">
              <div className="float" style={{ ['--tilt' as string]: '-3deg', ['--drift' as string]: '-0.04' }}>
                <NumberCard id={tender.id.toString()} rows={[['Stage', tender.phase], ['Kind', tender.quick ? 'Quick Quote' : 'Full tender'], ['Bids opened', String(tender.openedCount)]]} />
              </div>
            </div>
          ) : (
            <p className="empty">
              <span className="empty__title">No tenders yet</span>
              {deployed ? 'The tender contract is live and holds no tenders.' : 'The Gavelock tender contract has not been deployed to X Layer yet, so there is nothing to show here. The tender number card and the sealed-bid receipt appear on this page as soon as the first tender exists.'}
            </p>
          )}
        </div>
      </section>

      {deployed && (
        <section className="band" aria-label="Tenders">
          <div className="container stack">
            <h2 className="display band__title" style={{ fontSize: 'var(--text-2xl)' }}>
              The <em>board</em>
            </h2>
            <TenderList />
          </div>
        </section>
      )}

      <section className="band">
        <div className="container">
          <NetworkPanel />
        </div>
      </section>

      <WheelFinalSlot />
    </>
  );
}
