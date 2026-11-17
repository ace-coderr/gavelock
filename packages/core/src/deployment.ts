import type { Address } from './chain.ts';

/**
 * Gavelock's own contracts on X Layer mainnet. Every field is null until the contracts are deployed
 * (Gate B). The app and the tooling treat null as "not deployed" and say so; they never invent data.
 */
export interface Deployment {
  /** The tender contract: lifecycle, sealed bids, award, challenges, deposits. */
  tenders: Address | null;
  /** Evaluation panels: hidden score commit and reveal. Deployed by the tender contract. */
  panel: Address | null;
  /** Documents and clarifications, stored as contract code. Deployed by the tender contract. */
  records: Address | null;
  /** The Gavelock processor: the TapeOut circuits contract that holds the rule circuits. */
  processor: Address | null;
  /** The contract that holds the processor's transistor supply and tapes out rules. */
  ruleStock: Address | null;
  /** Block the tender contract was deployed in: the earliest block the app ever needs. */
  fromBlock: number | null;
}

export const DEPLOYMENT: Deployment = {
  tenders: null,
  panel: null,
  records: null,
  processor: null,
  ruleStock: null,
  fromBlock: null,
};

export type LiveDeployment = { [K in keyof Deployment]: NonNullable<Deployment[K]> };

export function isDeployed(d: Deployment = DEPLOYMENT): d is LiveDeployment {
  return Object.values(d).every((value) => value !== null);
}
