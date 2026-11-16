// Time-lock sealing: a bid is encrypted to a drand quicknet round. Anyone can open it once the network
// has published that round's signature; nobody can before, because the signature is the decryption key
// and it does not exist yet.
//
// Sealing needs no network access (the chain parameters are fixed). Opening fetches one round signature
// from a public drand endpoint and verifies it against the network's public key before using it.

import { Buffer, timelockDecrypt, timelockEncrypt } from 'tlock-js';
import { QUICKNET, roundTime } from './drand.ts';

/** A drand round signature as the public HTTP API returns it. */
export interface Beacon {
  round: number;
  randomness: string;
  signature: string;
}

/** Fetches one round from one endpoint. Replaceable so tests and other runtimes can supply their own. */
export type BeaconFetcher = (url: string) => Promise<Beacon>;

export interface OpenOptions {
  /** drand endpoints to try in order. Defaults to the public ones. */
  urls?: readonly string[];
  fetchBeacon?: BeaconFetcher;
  /** Current time in milliseconds. Defaults to the clock. */
  now?: () => number;
}

const CHAIN_INFO = {
  public_key: QUICKNET.publicKey,
  period: QUICKNET.period,
  genesis_time: QUICKNET.genesis,
  hash: QUICKNET.chainHash,
  groupHash: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
  schemeID: QUICKNET.scheme,
  metadata: { beaconID: 'quicknet' },
};

const defaultFetch: BeaconFetcher = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`drand answered ${response.status}`);
  return (await response.json()) as Beacon;
};

/** The object tlock-js asks for chain parameters and round signatures. */
function client(options: OpenOptions = {}) {
  const urls = options.urls ?? QUICKNET.urls;
  const fetchBeacon = options.fetchBeacon ?? defaultFetch;
  const get = async (round: number | 'latest'): Promise<Beacon> => {
    let lastError: unknown = new Error('no drand endpoint configured');
    for (const base of urls) {
      try {
        const beacon = await fetchBeacon(`${base}/${QUICKNET.chainHash}/public/${round}`);
        if (round !== 'latest' && beacon.round !== round) throw new Error(`drand returned round ${beacon.round}, asked for ${round}`);
        return beacon;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Could not fetch drand round ${round}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  };
  return {
    // Verification on: a signature that does not match the network key is rejected before use.
    options: { disableBeaconVerification: false, noCache: false, chainVerificationParams: { chainHash: QUICKNET.chainHash, publicKey: QUICKNET.publicKey } },
    chain: () => ({ baseUrl: urls[0] ?? '', info: async () => CHAIN_INFO }),
    get: (round: number) => get(round),
    latest: () => get('latest'),
  };
}

const ARMOR_HEADER = '-----BEGIN AGE ENCRYPTED FILE-----';
const ARMOR_FOOTER = '-----END AGE ENCRYPTED FILE-----';

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBinaryString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}

/**
 * Seal bytes so they can be opened at `round` and not before. Returns the binary ciphertext that is
 * stored on chain. Works offline.
 */
export async function seal(plaintext: Uint8Array, round: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(round) || round < 1) throw new RangeError('round must be a positive integer');
  const armored = await timelockEncrypt(round, Buffer.from(plaintext), client() as never);
  const body = armored
    .split('\n')
    .filter((line) => line !== '' && line !== ARMOR_HEADER && line !== ARMOR_FOOTER)
    .join('');
  return fromBase64(body);
}

export interface SealHeader {
  round: number;
  chainHash: string;
}

/**
 * Read which round and network a ciphertext says it is sealed to, without decrypting.
 * Returns null when the bytes are not a time-lock ciphertext at all.
 */
export function sealHeader(ciphertext: Uint8Array): SealHeader | null {
  const head = toBinaryString(ciphertext.subarray(0, 160));
  const match = /^age-encryption\.org\/v1\n-> tlock (\d{1,16}) ([0-9a-f]{64})\n/.exec(head);
  if (!match) return null;
  const round = Number(match[1]);
  return Number.isSafeInteger(round) && round >= 1 ? { round, chainHash: match[2]! } : null;
}

export class SealError extends Error {
  override name = 'SealError';
  readonly reason: 'not-a-seal' | 'wrong-network' | 'too-early' | 'unavailable' | 'corrupt';

  constructor(reason: SealError['reason'], message: string) {
    super(message);
    this.reason = reason;
  }
}

let silenced = 0;
let originalLog: typeof console.log | null = null;

/** tlock-js prints every beacon it fetches. Keep that off stdout, which a stdio server uses for its protocol. */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  if (silenced++ === 0) {
    originalLog = console.log;
    console.log = () => {};
  }
  try {
    return await work();
  } finally {
    if (--silenced === 0 && originalLog) {
      console.log = originalLog;
      originalLog = null;
    }
  }
}

/**
 * Open a sealed ciphertext. Fails with a SealError that says why: not a time-lock ciphertext, sealed
 * to another network, round not published yet, drand unreachable, or the ciphertext does not decrypt.
 */
export async function open(ciphertext: Uint8Array, options: OpenOptions = {}): Promise<Uint8Array> {
  const header = sealHeader(ciphertext);
  if (!header) throw new SealError('not-a-seal', 'These bytes are not a time-lock ciphertext.');
  if (header.chainHash !== QUICKNET.chainHash) throw new SealError('wrong-network', 'This ciphertext is sealed to a different drand network.');
  const now = (options.now ?? Date.now)();
  if (roundTime(header.round) * 1000 > now) {
    throw new SealError('too-early', `Sealed until drand round ${header.round} (${new Date(roundTime(header.round) * 1000).toISOString()}).`);
  }
  try {
    const opened = await quietly(() => timelockDecrypt(toBinaryString(ciphertext), client(options) as never));
    return new Uint8Array(opened);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Could not fetch drand round')) throw new SealError('unavailable', message);
    throw new SealError('corrupt', `The ciphertext does not open: ${message}`);
  }
}
