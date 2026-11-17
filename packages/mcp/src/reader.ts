// Reads Gavelock from X Layer. Read-only: no wallet, no key, no transaction.
import { createPublicClient, fallback, hexToBytes, http, parseAbi, type Address, type PublicClient } from 'viem';
import {
  DEPLOYMENT,
  INPUT_SPACE,
  MULTICALL3,
  RPC_LIMITS,
  XLAYER,
  gavelockAbi,
  inputToBytes,
  isDeployed,
  tenderPanelAbi,
  type Deployment,
  type LiveDeployment,
} from '@gavelock/core';

export const PHASES = ['Published', 'Clarifications', 'Bidding', 'Opening', 'Evaluation', 'Awarded', 'Standstill', 'Final', 'Cancelled'] as const;

const circuitsAbi = parseAbi(['function eval(uint256 id, bytes inputs) view returns (bytes)', 'function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)']);
const multicallAbi = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])']);

export class NotDeployedError extends Error {
  override name = 'NotDeployedError';
  constructor() {
    super('The Gavelock contracts are not deployed to X Layer yet, so there is nothing to read.');
  }
}

export interface ReaderOptions {
  rpcUrls?: readonly string[];
  deployment?: Deployment;
  client?: PublicClient;
}

/** The deployment can be overridden for testing: GAVELOCK_DEPLOYMENT is a JSON object with the same fields. */
export function deploymentFromEnv(env: NodeJS.ProcessEnv = process.env): Deployment {
  return env.GAVELOCK_DEPLOYMENT ? (JSON.parse(env.GAVELOCK_DEPLOYMENT) as Deployment) : DEPLOYMENT;
}

export function createReader(options: ReaderOptions = {}) {
  const client: PublicClient =
    options.client ??
    (createPublicClient({ transport: fallback((options.rpcUrls ?? XLAYER.rpcUrls).map((url) => http(url, { timeout: 15_000, retryCount: 1 }))) }) as PublicClient);
  const deployment = options.deployment ?? deploymentFromEnv();

  function live(): LiveDeployment {
    if (!isDeployed(deployment)) throw new NotDeployedError();
    return deployment;
  }

  const read = <T>(address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address, abi, functionName, args } as never) as Promise<T>;

  return {
    deployed: () => isDeployed(deployment),
    deployment,

    async tenderCount(): Promise<bigint> {
      return read<bigint>(live().tenders, gavelockAbi, 'tenderCount');
    },

    async tender(id: bigint) {
      const d = live();
      const [raw, phase] = await Promise.all([read<any>(d.tenders, gavelockAbi, 'getTender', [id]), read<number>(d.tenders, gavelockAbi, 'phaseOf', [id])]);
      return { raw, phase: PHASES[Number(phase)] ?? 'Published' };
    },

    async text(pointer: Address): Promise<string> {
      const bytes = hexToBytes(await read<`0x${string}`>(live().tenders, gavelockAbi, 'read', [pointer]));
      return new TextDecoder().decode(bytes);
    },

    async bids(id: bigint) {
      const d = live();
      const count = Number(await read<bigint>(d.tenders, gavelockAbi, 'bidCount', [id]));
      return client.multicall({
        allowFailure: false,
        contracts: Array.from({ length: count }, (_, i) => ({ address: d.tenders, abi: gavelockAbi, functionName: 'getBid', args: [id, BigInt(i)] }) as never),
      }) as Promise<any[]>;
    },

    /** Revealed panel scores, one array per member who revealed, one byte per bid. */
    async revealedScores(id: bigint, panelSize: number): Promise<number[][]> {
      if (panelSize === 0) return [];
      const d = live();
      const members = await read<Address[]>(d.panel, tenderPanelAbi, 'panelOf', [id]);
      const rows = (await client.multicall({
        allowFailure: false,
        contracts: members.map((m) => ({ address: d.panel, abi: tenderPanelAbi, functionName: 'memberOf', args: [id, m] }) as never),
      })) as any[];
      return rows.filter((m) => m.revealedBlock !== 0n).map((m) => [...hexToBytes(m.scores)]);
    },

    async challenges(id: bigint) {
      const d = live();
      const count = Number(await read<bigint>(d.tenders, gavelockAbi, 'challengeCount', [id]));
      return client.multicall({
        allowFailure: false,
        contracts: Array.from({ length: count }, (_, i) => ({ address: d.tenders, abi: gavelockAbi, functionName: 'getChallenge', args: [id, BigInt(i)] }) as never),
      }) as Promise<any[]>;
    },

    async bidsBy(bidder: Address): Promise<{ tenderId: bigint; bidIndex: bigint }[]> {
      const d = live();
      const count = Number(await read<bigint>(d.tenders, gavelockAbi, 'bidsOf', [bidder]));
      const rows = (await client.multicall({
        allowFailure: false,
        contracts: Array.from({ length: count }, (_, i) => ({ address: d.tenders, abi: gavelockAbi, functionName: 'bidOfBidder', args: [bidder, BigInt(i)] }) as never),
      })) as readonly (readonly [bigint, bigint])[];
      return rows.map(([tenderId, bidIndex]) => ({ tenderId, bidIndex }));
    },

    async tendersBy(buyer: Address): Promise<bigint[]> {
      const d = live();
      const count = Number(await read<bigint>(d.tenders, gavelockAbi, 'tendersOf', [buyer]));
      return (await client.multicall({
        allowFailure: false,
        contracts: Array.from({ length: count }, (_, i) => ({ address: d.tenders, abi: gavelockAbi, functionName: 'tenderOfBuyer', args: [buyer, BigInt(i)] }) as never),
      })) as bigint[];
    },

    /** Every output of a rule circuit, read from the chain. Null entries are inputs the chain did not answer validly. */
    async truthTable(circuitId: number): Promise<(number | null)[]> {
      const d = live();
      const words: (number | null)[] = new Array(INPUT_SPACE).fill(null);
      const BATCH = 64;
      for (let base = 0; base < INPUT_SPACE; base += BATCH) {
        const calls = Array.from({ length: BATCH }, (_, i) => ({
          target: d.processor,
          allowFailure: true,
          callData: encodeEval(BigInt(circuitId), base + i),
        }));
        const results = (await client.readContract({ address: MULTICALL3, abi: multicallAbi, functionName: 'aggregate3', args: [calls], gas: BigInt(RPC_LIMITS.callGasCap) } as never)) as { success: boolean; returnData: string }[];
        results.forEach((r, i) => {
          const ok = r.success && r.returnData.length >= 132 && BigInt(`0x${r.returnData.slice(66, 130)}`) === 1n;
          const word = ok ? parseInt(r.returnData.slice(130, 132), 16) : NaN;
          if (ok && word <= 31) words[base + i] = word;
        });
      }
      return words;
    },

    async circuitShape(circuitId: number) {
      const [nIn, nOut, nState, gateCount] = await read<readonly [number, number, number, number]>(live().processor, circuitsAbi, 'circuitInfo', [BigInt(circuitId)]);
      return { nIn, nOut, nState, gateCount };
    },
  };
}

import { encodeFunctionData } from 'viem';
function encodeEval(id: bigint, input: number): `0x${string}` {
  const bytes = inputToBytes(input);
  return encodeFunctionData({ abi: circuitsAbi, functionName: 'eval', args: [id, `0x${Buffer.from(bytes).toString('hex')}`] });
}

export type Reader = ReturnType<typeof createReader>;
