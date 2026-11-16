import { createPublicClient, defineChain, fallback, http } from 'viem';
import { MULTICALL3, XLAYER } from '@gavelock/core';

export const xLayer = defineChain({
  id: XLAYER.id,
  name: XLAYER.name,
  nativeCurrency: XLAYER.nativeCurrency,
  rpcUrls: { default: { http: [...XLAYER.rpcUrls] } },
  blockExplorers: { default: { name: 'OKLink', url: XLAYER.explorer } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

/** Read-only client. Tries each public node in order, so one node being down is not an outage. */
export const publicClient = createPublicClient({
  chain: xLayer,
  transport: fallback(
    XLAYER.rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 1 })),
    { rank: false },
  ),
});
