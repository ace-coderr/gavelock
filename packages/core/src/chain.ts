// Constants read from X Layer mainnet on 16 November 2026. Evidence for each: docs/PROTOCOL.md.

export type Address = `0x${string}`;

export const XLAYER = {
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  /** Public nodes that answer browsers (CORS `*`). The first is the default. */
  rpcUrls: ['https://rpc.xlayer.tech', 'https://xlayer.drpc.org'],
  explorer: 'https://www.oklink.com/xlayer',
  /** Seconds between blocks, averaged over 1,000 blocks. */
  blockTime: 1,
} as const;

/** What the public node allows. The app sizes its reads from these. */
export const RPC_LIMITS = {
  /** eth_getLogs: largest `toBlock - fromBlock` the node accepts. */
  maxLogRange: 100,
  /** Gas given to one eth_call. */
  callGasCap: 50_000_000,
} as const;

export const TAPEOUT = {
  /** Processor factory (UUPS proxy). Upgradeable by its owner. */
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  /** Beacon behind every processor's circuits contract. Its owner is the zero address. */
  circuitBeacon: '0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C',
  /** Implementation behind the circuit beacon when Gavelock was designed. */
  circuitImplementation: '0x977f217887E085D298Cb3819cDAD5A0ee35F29B2',
  /** ERC-20 the factory charges processor and mint fees in. 8 decimals. */
  bem: '0x60e62Efa9405d6873C5deaBD4E6CC91c25363952',
  /** ERC-6551 container opener, used only for the DeWEB copy of the site. */
  opener: '0x536add8f30f03b69f6fbf29d425a816a0dc50106',
  siteRegistry: '0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6',
  domainBinding: '0x68809fd2fb343aa57d0aeb7f33defe477c9666f9',
} as const satisfies Record<string, Address>;

export const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

/** Shape of every Gavelock rule circuit: banded inputs in, eligible + score out. */
export const RULE_SHAPE = {
  inputs: 11,
  outputs: 5,
  /** Largest netlist the rule builder will tape out. */
  maxNand: 1500,
} as const;

export function explorerAddress(address: string): string {
  return `${XLAYER.explorer}/address/${address}`;
}

export function explorerTx(hash: string): string {
  return `${XLAYER.explorer}/tx/${hash}`;
}
