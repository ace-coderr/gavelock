// Reading rule circuits from the chain: the whole truth table, one multicall batch at a time.
import { bytesToHex, encodeFunctionData, type Address, type Hex } from 'viem';
import { DEPLOYMENT, INPUT_SPACE, RPC_LIMITS, inputToBytes, isDeployed, ruleStockAbi } from '@gavelock/core';
import { publicClient } from './client.ts';

// Written out as JSON: viem's text-ABI parser is bigger than every ABI fragment the app needs.
const circuitsAbi = [
  { type: 'function', name: 'eval', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }, { name: 'inputs', type: 'bytes' }], outputs: [{ name: '', type: 'bytes' }] },
  { type: 'function', name: 'circuitInfo', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ name: 'nIn', type: 'uint32' }, { name: 'nOut', type: 'uint32' }, { name: 'nState', type: 'uint32' }, { name: 'gateCount', type: 'uint32' }] },
] as const;

const multicallAbi = [
  {
    type: 'function',
    name: 'aggregate3',
    stateMutability: 'payable',
    inputs: [{ name: 'calls', type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'allowFailure', type: 'bool' }, { name: 'callData', type: 'bytes' }] }],
    outputs: [{ name: '', type: 'tuple[]', components: [{ name: 'success', type: 'bool' }, { name: 'returnData', type: 'bytes' }] }],
  },
] as const;

export interface OnChainRule {
  id: number;
  author: Address;
  gates: number;
  blockNumber: bigint;
  label: string;
}

export async function listOnChainRules(): Promise<OnChainRule[]> {
  if (!isDeployed(DEPLOYMENT)) return [];
  const stock = DEPLOYMENT.ruleStock;
  const count = await publicClient.readContract({ address: stock, abi: ruleStockAbi, functionName: 'ruleCount' });
  if (count === 0n) return [];
  const ids = await publicClient.readContract({ address: stock, abi: ruleStockAbi, functionName: 'ruleIds', args: [0n, count] });
  const infos = await publicClient.multicall({
    allowFailure: false,
    contracts: ids.map((id) => ({ address: stock, abi: ruleStockAbi, functionName: 'rule', args: [id] }) as const),
  });
  return ids.map((id, k) => {
    const [author, gates, blockNumber, label] = infos[k]!;
    return { id: Number(id), author, gates, blockNumber, label };
  });
}

/** Evaluations per multicall. Each one costs up to a few hundred thousand gas; the node allows 50 million per call. */
const BATCH = 64;

export interface TableRead {
  /** One 5-bit output word per input, or null for an input the chain could not answer. */
  words: (number | null)[];
  /** Inputs whose answer was missing or not exactly one byte. */
  failures: number[];
}

/**
 * Read every output of a rule circuit from the chain. `onProgress` is called after each batch so the
 * page can show a live count. Cancels between batches when `signal` aborts.
 */
export async function readTruthTable(processor: Address, circuitId: number, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<TableRead> {
  const words: (number | null)[] = new Array(INPUT_SPACE).fill(null);
  const failures: number[] = [];
  for (let base = 0; base < INPUT_SPACE; base += BATCH) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const size = Math.min(BATCH, INPUT_SPACE - base);
    const calls = Array.from({ length: size }, (_, i) => ({
      target: processor,
      allowFailure: true,
      callData: encodeFunctionData({ abi: circuitsAbi, functionName: 'eval', args: [BigInt(circuitId), bytesToHex(inputToBytes(base + i))] }),
    }));
    const results = await publicClient.readContract({
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      abi: multicallAbi,
      functionName: 'aggregate3',
      args: [calls],
      gas: BigInt(RPC_LIMITS.callGasCap),
    } as never) as { success: boolean; returnData: Hex }[];
    results.forEach((r, i) => {
      // ABI-encoded bytes: offset, length, data. A rule answers with exactly one byte.
      const ok = r.success && r.returnData.length >= 132 && BigInt(`0x${r.returnData.slice(66, 130)}`) === 1n;
      const word = ok ? parseInt(r.returnData.slice(130, 132), 16) : NaN;
      if (ok && word <= 31) words[base + i] = word;
      else failures.push(base + i);
    });
    onProgress?.(base + size);
  }
  return { words, failures };
}

export async function readCircuitShape(processor: Address, circuitId: number) {
  const [nIn, nOut, nState, gateCount] = await publicClient.readContract({ address: processor, abi: circuitsAbi, functionName: 'circuitInfo', args: [BigInt(circuitId)] });
  return { nIn, nOut, nState, gateCount };
}
