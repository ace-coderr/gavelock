import { Link } from '../lib/router.tsx';
import { DEPLOYMENT, STARTER_RULES, compileRule, isDeployed, truthTable } from '@gavelock/core';
import { DragRow } from '../components/Controls.tsx';
import { RuleBuilder } from '../components/RuleBuilder.tsx';
import { shortAddress } from '../lib/format.ts';
import { listOnChainRules } from '../lib/rules.ts';
import { useAsync } from '../lib/useAsync.ts';

// Each starter rule's circuit size is worked out here, in the visitor's browser, from the rule's definition.
const starterSizes = STARTER_RULES.map((rule) => compileRule(truthTable(rule.spec)).gates);

export function Rules() {
  const deployed = isDeployed(DEPLOYMENT);
  const onChain = useAsync(() => listOnChainRules(), []);

  return (
    <div className="stack stagger">
      <header className="page__head">
        <span className="eyebrow">Rule Library</span>
        <h1 className="title">The scoring rules a tender can use.</h1>
        <p className="lede">
          A rule is a small logic circuit. It sees six facts about a bid and returns whether the bid is eligible and its
          score. Every rule has only 2,048 possible inputs, so you can read every outcome before you bid.
        </p>
      </header>

      <section className="stack" aria-label="Starter rules">
        <h2 className="card__title">Starter rules</h2>
        <DragRow label="Starter rules">
          {STARTER_RULES.map((rule, k) => (
            <article key={rule.key} className="card">
              <div className="card__head">
                <h3 className="card__title">{rule.name}</h3>
                <span className="status status--pending">{rule.mode === 'quick' ? 'Quick Quote' : 'Full tender'}</span>
              </div>
              <p style={{ color: 'var(--color-text-muted)' }}>{rule.summary}</p>
              <dl className="facts" style={{ marginTop: 'var(--space-4)' }}>
                <div className="fact">
                  <dt className="fact__label">Circuit size</dt>
                  <dd className="fact__value mono">{starterSizes[k]} NAND gates</dd>
                </div>
                <div className="fact">
                  <dt className="fact__label">Weights</dt>
                  <dd className="fact__value">
                    {Object.entries(rule.spec.weights)
                      .filter(([, w]) => w > 0)
                      .map(([name, w]) => `${name} ${w}%`)
                      .join(' · ')}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </DragRow>
      </section>

      <RuleBuilder />

      <section className="stack" aria-label="Rules on chain">
        <h2 className="card__title">On X Layer</h2>
        {!deployed ? (
          <p className="notice">The Gavelock processor has not been deployed yet, so no rule has been taped out on chain. The rules above are the ones that will be.</p>
        ) : onChain.state === 'loading' ? (
          <span className="skeleton" />
        ) : onChain.state === 'error' && !onChain.data ? (
          <div className="notice notice--danger" role="alert">
            <span>Could not read the rules: {onChain.error}</span>
            <div>
              <button type="button" className="button" onClick={onChain.reload}>
                Try again
              </button>
            </div>
          </div>
        ) : onChain.data!.length === 0 ? (
          <p className="notice">No rule has been taped out yet.</p>
        ) : (
          <DragRow label="Rules on chain">
            {onChain.data!.map((rule) => (
              <article key={rule.id} className="card">
                <div className="card__head">
                  <h3 className="card__title">{rule.label || `Circuit ${rule.id}`}</h3>
                  <Link className="button" to={`/rules/${rule.id}`}>
                    Open the Rule Prover
                  </Link>
                </div>
                <dl className="facts">
                  <div className="fact">
                    <dt className="fact__label">Circuit</dt>
                    <dd className="fact__value mono">#{rule.id}</dd>
                  </div>
                  <div className="fact">
                    <dt className="fact__label">Size</dt>
                    <dd className="fact__value mono">{rule.gates} NAND gates</dd>
                  </div>
                  <div className="fact">
                    <dt className="fact__label">Taped out by</dt>
                    <dd className="fact__value mono">{shortAddress(rule.author)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </DragRow>
        )}
      </section>
    </div>
  );
}
