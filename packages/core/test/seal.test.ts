import { describe, expect, it } from 'vitest';
import { QUICKNET, decodeBid, encodeBid, roundTime, type Bid } from '../src/index.ts';
import { SealError, open, seal, sealHeader, type Beacon } from '../src/seal.ts';

// A real quicknet round, as published by the network on 16 November 2026. Public data.
const ROUND = 34_005_040;
const BEACON: Beacon = {
  round: ROUND,
  randomness: '579af8aca4c8f6d98c736960ec2819cd761b9d4ff846b24b2496fbece5189aea',
  signature: 'a0193eb8a4880a7603ed18900ee44b7f99bb58da3a2370013572a5fc23174913e01091c41d46ce5f07b7970968e409c5',
};

const bid: Bid = { price: 125_000_00n, deliveryDays: 21, compliance: 0b1011, note: 'Two lots; first within 10 days.', salt: `0x${'5a'.repeat(32)}` };
const afterRound = () => roundTime(ROUND) * 1000 + 1;
// Serves the recorded round and nothing else, so these tests never touch the network.
const recorded = async (url: string): Promise<Beacon> => {
  if (!url.endsWith(`/${QUICKNET.chainHash}/public/${ROUND}`)) throw new Error(`unexpected request ${url}`);
  return BEACON;
};

describe('time-lock sealing', () => {
  it('seals offline and opens with the round signature', async () => {
    const plaintext = encodeBid(bid);
    const ciphertext = await seal(plaintext, ROUND);
    expect(ciphertext.length).toBeGreaterThan(plaintext.length);
    expect(ciphertext.length).toBeLessThan(plaintext.length + 500);
    expect(sealHeader(ciphertext)).toEqual({ round: ROUND, chainHash: QUICKNET.chainHash });
    const opened = await open(ciphertext, { fetchBeacon: recorded, now: afterRound });
    expect(opened).toEqual(plaintext);
    expect(decodeBid(opened)).toEqual(bid);
  });

  it('gives a different ciphertext every time', async () => {
    const plaintext = encodeBid(bid);
    const [a, b] = await Promise.all([seal(plaintext, ROUND), seal(plaintext, ROUND)]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('refuses to open before the round', async () => {
    const ciphertext = await seal(encodeBid(bid), ROUND);
    const early = open(ciphertext, { fetchBeacon: recorded, now: () => roundTime(ROUND) * 1000 - 1 });
    await expect(early).rejects.toMatchObject({ name: 'SealError', reason: 'too-early' });
  });

  it('cannot be opened with another round’s signature', async () => {
    const ciphertext = await seal(encodeBid(bid), ROUND + 1);
    const wrongKey = async (): Promise<Beacon> => ({ ...BEACON, round: ROUND + 1 });
    const attempt = open(ciphertext, { fetchBeacon: wrongKey, now: () => roundTime(ROUND + 1) * 1000 + 1 });
    await expect(attempt).rejects.toBeInstanceOf(SealError);
  });

  it('rejects a forged signature', async () => {
    const ciphertext = await seal(encodeBid(bid), ROUND);
    const forged = async (): Promise<Beacon> => ({ ...BEACON, signature: BEACON.signature.replace(/^a0/, 'a1') });
    await expect(open(ciphertext, { fetchBeacon: forged, now: afterRound })).rejects.toBeInstanceOf(SealError);
  });

  it('tries the next endpoint when one fails, and reports when all fail', async () => {
    const ciphertext = await seal(encodeBid(bid), ROUND);
    const seen: string[] = [];
    const flaky = async (url: string): Promise<Beacon> => {
      seen.push(url);
      if (url.startsWith('https://down.example')) throw new Error('connection refused');
      return BEACON;
    };
    const opened = await open(ciphertext, { urls: ['https://down.example', 'https://up.example'], fetchBeacon: flaky, now: afterRound });
    expect(decodeBid(opened)).toEqual(bid);
    expect(seen.map((u) => new URL(u).host)).toEqual(['down.example', 'up.example']);
    const dead = async (): Promise<Beacon> => {
      throw new Error('offline');
    };
    await expect(open(ciphertext, { fetchBeacon: dead, now: afterRound })).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('says why bytes that are not a seal cannot be opened', async () => {
    await expect(open(new Uint8Array(0))).rejects.toMatchObject({ reason: 'not-a-seal' });
    await expect(open(Uint8Array.from({ length: 300 }, (_, i) => i & 255))).rejects.toMatchObject({ reason: 'not-a-seal' });
    expect(sealHeader(new TextEncoder().encode('age-encryption.org/v1\n-> X25519 abc\n'))).toBeNull();
    const other = new TextEncoder().encode(`age-encryption.org/v1\n-> tlock 5 ${'0'.repeat(64)}\nxxxx\n--- yyyy\n`);
    expect(sealHeader(other)).toEqual({ round: 5, chainHash: '0'.repeat(64) });
    await expect(open(other, { now: afterRound })).rejects.toMatchObject({ reason: 'wrong-network' });
  });

  it('reports a damaged ciphertext', async () => {
    const ciphertext = await seal(encodeBid(bid), ROUND);
    const damaged = ciphertext.slice();
    damaged[damaged.length - 5] = damaged[damaged.length - 5]! ^ 0xff;
    await expect(open(damaged, { fetchBeacon: recorded, now: afterRound })).rejects.toMatchObject({ reason: 'corrupt' });
    await expect(open(ciphertext.subarray(0, ciphertext.length - 40), { fetchBeacon: recorded, now: afterRound })).rejects.toBeInstanceOf(SealError);
  });

  it('does not write to the console while opening', async () => {
    const ciphertext = await seal(encodeBid(bid), ROUND);
    const original = console.log;
    const lines: unknown[] = [];
    console.log = (...args: unknown[]) => lines.push(args);
    try {
      await Promise.all([open(ciphertext, { fetchBeacon: recorded, now: afterRound }), open(ciphertext, { fetchBeacon: recorded, now: afterRound })]);
    } finally {
      console.log = original;
    }
    expect(lines).toEqual([]);
    expect(console.log).toBe(original);
  });
});
