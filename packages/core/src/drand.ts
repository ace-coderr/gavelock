// drand quicknet: the public randomness beacon bids are time-locked to.
// A bid sealed to round r can be opened by anyone once the network publishes round r, and by nobody before.

export const QUICKNET = {
  chainHash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  publicKey:
    '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  /** Unix seconds of round 1. */
  genesis: 1692803367,
  /** Seconds between rounds. */
  period: 3,
  scheme: 'bls-unchained-g1-rfc9380',
  /** Endpoints that answer browsers. */
  urls: ['https://api.drand.sh', 'https://api2.drand.sh', 'https://drand.cloudflare.com'],
} as const;

/** Unix seconds at which a round is published. */
export function roundTime(round: number): number {
  if (!Number.isSafeInteger(round) || round < 1) throw new RangeError('round must be a positive integer');
  return QUICKNET.genesis + (round - 1) * QUICKNET.period;
}

/**
 * The first round published at or after a moment (unix seconds).
 * A tender's bid deadline maps to this round: nothing sealed to it can be opened before the deadline.
 */
export function roundAtOrAfter(unixSeconds: number): number {
  if (!Number.isSafeInteger(unixSeconds)) throw new RangeError('time must be whole unix seconds');
  if (unixSeconds <= QUICKNET.genesis) return 1;
  return Math.ceil((unixSeconds - QUICKNET.genesis) / QUICKNET.period) + 1;
}

/** The latest round already published at a moment (unix seconds), or 0 before genesis. */
export function latestRoundAt(unixSeconds: number): number {
  if (!Number.isSafeInteger(unixSeconds)) throw new RangeError('time must be whole unix seconds');
  if (unixSeconds < QUICKNET.genesis) return 0;
  return Math.floor((unixSeconds - QUICKNET.genesis) / QUICKNET.period) + 1;
}
