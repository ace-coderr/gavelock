import type { Address } from './chain.ts';

/**
 * Gavelock's own contracts on X Layer mainnet. Every field is null until the contract is deployed
 * (Gate B). The app and the tooling treat null as "not deployed" and say so; they never invent data.
 */
export interface Deployment {
  /** The tender contract. */
  tenders: Address | null;
  /** The Gavelock processor: the TapeOut circuits contract that holds the rule circuits. */
  processor: Address | null;
  /** The contract that holds the processor's transistor supply and tapes out custom rules. */
  ruleStock: Address | null;
  /** Block the tender contract was deployed in: the earliest block the app ever needs. */
  fromBlock: number | null;
}

export const DEPLOYMENT: Deployment = {
  tenders: null,
  processor: null,
  ruleStock: null,
  fromBlock: null,
};

export function isDeployed(d: Deployment = DEPLOYMENT): d is Deployment & { tenders: Address; processor: Address } {
  return d.tenders !== null && d.processor !== null;
}
