import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createWalletClient, custom, formatEther, type Address, type EIP1193Provider, type Hash, type WalletClient } from 'viem';
import { XLAYER } from '@gavelock/core';
import { publicClient, xLayer } from './client.ts';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

interface WalletState {
  /** A wallet extension is present in this browser. */
  available: boolean;
  account: Address | null;
  /** The wallet is on X Layer. */
  onXLayer: boolean;
  connect: () => Promise<void>;
  switchToXLayer: () => Promise<void>;
  client: WalletClient | null;
  error: string | null;
}

const Context = createContext<WalletState | null>(null);

const hexChain = `0x${XLAYER.id.toString(16)}`;

function message(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string; code?: number };
  if (e.code === 4001) return 'The request was rejected in the wallet.';
  return (e.shortMessage ?? e.message ?? 'Unknown error').split('\n')[0] ?? 'Unknown error';
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const provider = typeof window === 'undefined' ? undefined : window.ethereum;
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider) return;
    // Only reads accounts the visitor has already approved for this site; never prompts on load.
    provider.request({ method: 'eth_accounts' }).then((accounts) => setAccount((accounts as Address[])[0] ?? null)).catch(() => {});
    provider.request({ method: 'eth_chainId' }).then((id) => setChainId(Number(id))).catch(() => {});
    const onAccounts = (accounts: unknown) => setAccount((accounts as Address[])[0] ?? null);
    const onChain = (id: unknown) => setChainId(Number(id));
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener('accountsChanged', onAccounts);
      provider.removeListener('chainChanged', onChain);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return;
    setError(null);
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as Address[];
      setAccount(accounts[0] ?? null);
    } catch (e) {
      setError(message(e));
    }
  }, [provider]);

  const switchToXLayer = useCallback(async () => {
    if (!provider) return;
    setError(null);
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] });
    } catch (e) {
      if ((e as { code?: number }).code === 4902) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: hexChain, chainName: XLAYER.name, nativeCurrency: XLAYER.nativeCurrency, rpcUrls: [...XLAYER.rpcUrls], blockExplorerUrls: [XLAYER.explorer] }],
          });
        } catch (inner) {
          setError(message(inner));
        }
      } else {
        setError(message(e));
      }
    }
  }, [provider]);

  const client = useMemo(() => (provider && account ? createWalletClient({ account, chain: xLayer, transport: custom(provider) }) : null), [provider, account]);

  const value: WalletState = { available: Boolean(provider), account, onXLayer: chainId === XLAYER.id, connect, switchToXLayer, client, error };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWallet(): WalletState {
  const value = useContext(Context);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}

// ---------------------------------------------------------------- transactions

export type TxState =
  | { step: 'idle' }
  | { step: 'quote'; feeText: string }
  | { step: 'signing' }
  | { step: 'pending'; hash: Hash }
  | { step: 'confirmed'; hash: Hash; gasUsed: bigint; blockNumber: bigint }
  | { step: 'failed'; message: string; hash?: Hash };

export interface TxRequest {
  to: Address;
  data: `0x${string}`;
  /** Wei sent with the call: a tender fee or a bid deposit. */
  value?: bigint;
}

/**
 * One transaction at a time, with every state the visitor needs to see: the fee before signing,
 * waiting for the wallet, pending on chain, confirmed, or failed with the reason.
 * Nothing is sent until `send` is called, and `send` is only ever called from a button press.
 */
export function useTransaction() {
  const wallet = useWallet();
  const [state, setState] = useState<TxState>({ step: 'idle' });

  const quote = useCallback(
    async (request: TxRequest) => {
      if (!wallet.account) return;
      try {
        const [gas, gasPrice] = await Promise.all([publicClient.estimateGas({ account: wallet.account, ...request }), publicClient.getGasPrice()]);
        const fee = gas * gasPrice;
        const sent = request.value ?? 0n;
        setState({ step: 'quote', feeText: `${sent > 0n ? `${formatEther(sent)} OKB sent with the call, plus ` : ''}about ${formatEther(fee)} OKB in network fees (${gas.toLocaleString('en-US')} gas)` });
      } catch (e) {
        // The node refuses to estimate a call that would revert: that reason is the useful thing to show.
        setState({ step: 'failed', message: `This transaction would fail: ${message(e)}` });
      }
    },
    [wallet.account],
  );

  const send = useCallback(
    async (request: TxRequest) => {
      if (!wallet.client || !wallet.account) return;
      setState({ step: 'signing' });
      let hash: Hash;
      try {
        hash = await wallet.client.sendTransaction({ account: wallet.account, chain: xLayer, ...request });
      } catch (e) {
        setState({ step: 'failed', message: message(e) });
        return;
      }
      setState({ step: 'pending', hash });
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status === 'success') setState({ step: 'confirmed', hash, gasUsed: receipt.gasUsed, blockNumber: receipt.blockNumber });
        else setState({ step: 'failed', message: 'The transaction was mined but reverted.', hash });
      } catch (e) {
        setState({ step: 'failed', message: `Could not confirm the transaction: ${message(e)}. It may still go through; check the explorer.`, hash });
      }
    },
    [wallet.client, wallet.account],
  );

  const reset = useCallback(() => setState({ step: 'idle' }), []);
  return { state, quote, send, reset };
}
