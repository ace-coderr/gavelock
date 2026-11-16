import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, hexToBytes, keccak256, toHex } from 'viem';
import { NOTE_MAX_BYTES, PRICE_MAX, commitmentOf, decodeBid, encodeBid, noteBytes, randomSalt, validateBid, type Bid, type BidContext } from '../src/index.ts';

const salt = `0x${'ab'.repeat(32)}` as const;
const bid: Bid = { price: 125_000_00n, deliveryDays: 21, compliance: 0b1011, note: 'Two lots; first within 10 days.', salt };
const context: BidContext = {
  chainId: 196,
  contract: '0x00000000000000000000000000000000000000c1',
  tenderId: 7n,
  bidder: '0x00000000000000000000000000000000000000b1',
};

describe('bid encoding', () => {
  it('round-trips', () => {
    expect(decodeBid(encodeBid(bid))).toEqual(bid);
    const empty: Bid = { ...bid, note: '', compliance: 0, deliveryDays: 0, price: 1n };
    expect(decodeBid(encodeBid(empty))).toEqual(empty);
    const big: Bid = { ...bid, price: PRICE_MAX, compliance: 0xffff_ffff, deliveryDays: 0xffff_ffff, note: 'é'.repeat(140) };
    expect(decodeBid(encodeBid(big))).toEqual(big);
  });

  it('is the ABI encoding the contract hashes', () => {
    const expected = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint32' }, { type: 'uint32' }, { type: 'string' }, { type: 'bytes32' }],
      [bid.price, bid.deliveryDays, bid.compliance, bid.note, bid.salt],
    );
    expect(toHex(encodeBid(bid))).toBe(expected);
  });

  it('validates', () => {
    expect(validateBid(bid)).toEqual([]);
    expect(validateBid({ ...bid, price: 0n })).toHaveLength(1);
    expect(validateBid({ ...bid, price: PRICE_MAX + 1n })).toHaveLength(1);
    expect(validateBid({ ...bid, deliveryDays: -1 })).toHaveLength(1);
    expect(validateBid({ ...bid, deliveryDays: 1.5 })).toHaveLength(1);
    expect(validateBid({ ...bid, compliance: 2 ** 32 })).toHaveLength(1);
    expect(validateBid({ ...bid, salt: '0x1234' })).toHaveLength(1);
    expect(validateBid({ ...bid, note: 'x'.repeat(NOTE_MAX_BYTES) })).toEqual([]);
    expect(validateBid({ ...bid, note: 'x'.repeat(NOTE_MAX_BYTES + 1) })).toHaveLength(1);
    // The cap is in bytes, not characters.
    expect(noteBytes('é'.repeat(141))).toBe(282);
    expect(validateBid({ ...bid, note: 'é'.repeat(141) })).toHaveLength(1);
    expect(() => encodeBid({ ...bid, price: 0n })).toThrow();
  });

  it('rejects malformed and non-canonical plaintext', () => {
    expect(() => decodeBid(new Uint8Array(0))).toThrow(/do not decode/);
    expect(() => decodeBid(Uint8Array.of(1, 2, 3))).toThrow(/do not decode/);
    const good = encodeBid(bid);
    // Trailing bytes after a valid encoding.
    const padded = new Uint8Array(good.length + 32);
    padded.set(good);
    expect(() => decodeBid(padded)).toThrow(/not canonical/);
    // A second, differently laid out encoding of the same values: move the string 32 bytes further out.
    const moved = hexToBytes(
      `0x${toHex(good).slice(2, 2 + 64 * 3)}${(0xc0).toString(16).padStart(64, '0')}${toHex(good).slice(2 + 64 * 4, 2 + 64 * 5)}${'00'.repeat(32)}${toHex(good).slice(2 + 64 * 5)}`,
    );
    expect(() => decodeBid(moved)).toThrow(/not canonical/);
    // A value out of range for its type.
    const overflow = good.slice();
    overflow[32 + 27] = 1; // deliveryDays word: a bit above 32 bits
    expect(() => decodeBid(overflow)).toThrow();
  });

  it('makes random salts', () => {
    const a = randomSalt();
    const b = randomSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('commitment', () => {
  it('is the hash the contract computes', () => {
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint32' }, { type: 'uint32' }, { type: 'string' }, { type: 'bytes32' }],
        [196n, context.contract, 7n, context.bidder, bid.price, bid.deliveryDays, bid.compliance, bid.note, bid.salt],
      ),
    );
    expect(commitmentOf(context, bid)).toBe(expected);
  });

  it('changes with every field and every part of the context', () => {
    const base = commitmentOf(context, bid);
    const variants = [
      commitmentOf(context, { ...bid, price: bid.price + 1n }),
      commitmentOf(context, { ...bid, deliveryDays: 22 }),
      commitmentOf(context, { ...bid, compliance: 0b1111 }),
      commitmentOf(context, { ...bid, note: `${bid.note} ` }),
      commitmentOf(context, { ...bid, salt: `0x${'ac'.repeat(32)}` }),
      commitmentOf({ ...context, chainId: 1 }, bid),
      commitmentOf({ ...context, contract: '0x00000000000000000000000000000000000000c2' }, bid),
      commitmentOf({ ...context, tenderId: 8n }, bid),
      commitmentOf({ ...context, bidder: '0x00000000000000000000000000000000000000b2' }, bid),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });

  it('cannot be confused by moving bytes between the note and other fields', () => {
    // abi.encode length-prefixes the note, so no two different bids share an encoding.
    const a = commitmentOf(context, { ...bid, note: 'ab', compliance: 1 });
    const b = commitmentOf(context, { ...bid, note: 'a', compliance: 1 });
    expect(a).not.toBe(b);
  });

  it('rejects a bad context', () => {
    expect(() => commitmentOf({ ...context, contract: '0x12' as never }, bid)).toThrow();
    expect(() => commitmentOf({ ...context, chainId: 0 }, bid)).toThrow();
    expect(() => commitmentOf({ ...context, tenderId: -1n }, bid)).toThrow();
  });
});
