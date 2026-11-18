import { useCallback, useEffect, useRef, useState } from 'react';
import { getAddress } from 'viem';
import { TAPEOUT } from '@gavelock/core';
import { publicClient } from './client.ts';

const abi = [
  { type: 'function', name: 'cpuCount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'implementation', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const;

export interface NetworkSnapshot {
  blockNumber: bigint;
  blockTimestamp: number;
  gasPrice: bigint;
  /** Processors registered with the TapeOut factory. */
  processors: bigint;
  /** True when the code behind every processor is still the code Gavelock was designed against. */
  circuitCodeUnchanged: boolean;
  /** True when nobody holds the right to replace that code. */
  circuitBeaconOwnerless: boolean;
  fetchedAt: number;
}

export type NetworkStatus =
  | { state: 'loading'; snapshot: null; error: null }
  | { state: 'ok'; snapshot: NetworkSnapshot; error: null }
  | { state: 'error'; snapshot: NetworkSnapshot | null; error: string };

const ZERO = '0x0000000000000000000000000000000000000000';
const REFRESH_MS = 20_000;

async function fetchSnapshot(): Promise<NetworkSnapshot> {
  const [block, gasPrice, [processors, implementation, owner]] = await Promise.all([
    publicClient.getBlock(),
    publicClient.getGasPrice(),
    publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: TAPEOUT.factory, abi, functionName: 'cpuCount' },
        { address: TAPEOUT.circuitBeacon, abi, functionName: 'implementation' },
        { address: TAPEOUT.circuitBeacon, abi, functionName: 'owner' },
      ],
    }),
  ]);
  return {
    blockNumber: block.number,
    blockTimestamp: Number(block.timestamp),
    gasPrice,
    processors,
    circuitCodeUnchanged: getAddress(implementation) === getAddress(TAPEOUT.circuitImplementation),
    circuitBeaconOwnerless: owner === ZERO,
    fetchedAt: Date.now(),
  };
}

function describe(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string };
  const first = (e.shortMessage ?? e.message ?? 'Unknown error').split('\n')[0] ?? 'Unknown error';
  return first.endsWith('.') ? first.slice(0, -1) : first;
}

/**
 * Live facts from X Layer, refreshed while the tab is visible.
 * A failed refresh keeps the last good snapshot and reports the error next to it.
 */
export function useNetworkStatus(): NetworkStatus & { refresh: () => void } {
  const [status, setStatus] = useState<NetworkStatus>({ state: 'loading', snapshot: null, error: null });
  const last = useRef<NetworkSnapshot | null>(null);
  const running = useRef(false);

  const refresh = useCallback(() => {
    if (running.current) return;
    running.current = true;
    fetchSnapshot()
      .then((snapshot) => {
        last.current = snapshot;
        setStatus({ state: 'ok', snapshot, error: null });
      })
      .catch((error: unknown) => {
        setStatus({ state: 'error', snapshot: last.current, error: describe(error) });
      })
      .finally(() => {
        running.current = false;
      });
  }, []);

  useEffect(() => {
    refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  return { ...status, refresh };
}
