// A bid, the bytes that get time-locked, and the commitment the contract stores.
//
// Sealed plaintext:  abi.encode(uint256 price, uint32 deliveryDays, uint32 compliance, string note, bytes32 salt)
// Commitment:        keccak256(abi.encode(uint256 chainId, address tenderContract, uint256 tenderId, address bidder,
//                                         uint256 price, uint32 deliveryDays, uint32 compliance, string note, bytes32 salt))
//
// The commitment binds the chain, the contract, the tender and the bidder, so a commitment copied into
// another tender or submitted by another address can never be opened. The salt keeps a low-entropy bid
// (a round price, a common delivery time) from being guessed from its commitment before the deadline.

import { decodeAbiParameters, encodeAbiParameters, hexToBytes, isAddress, keccak256, toHex, type Hex } from 'viem';
import type { Address } from './chain.ts';

/** Longest proposal note, in UTF-8 bytes. The contract enforces the same cap at opening. */
export const NOTE_MAX_BYTES = 280;
/** Prices are whole minor units of the tender currency and fit in 128 bits. */
export const PRICE_MAX = (1n << 128n) - 1n;
export const UINT32_MAX = 0xffff_ffff;

export interface Bid {
  /** Whole minor units of the tender currency (cents, kobo, ...). At least 1. */
  price: bigint;
  deliveryDays: number;
  /** Bit i set = the bidder claims checklist item i. */
  compliance: number;
  note: string;
  /** 32 random bytes, hex. */
  salt: Hex;
}

export interface BidContext {
  chainId: number;
  /** The tender contract. */
  contract: Address;
  tenderId: bigint;
  bidder: Address;
}

const PLAINTEXT_TYPES = [{ type: 'uint256' }, { type: 'uint32' }, { type: 'uint32' }, { type: 'string' }, { type: 'bytes32' }] as const;
const COMMITMENT_TYPES = [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, ...PLAINTEXT_TYPES] as const;

const utf8 = new TextEncoder();

export function noteBytes(note: string): number {
  return utf8.encode(note).length;
}

/** Problems with a bid, in plain words. Empty when the bid can be sealed. */
export function validateBid(bid: Bid): string[] {
  const problems: string[] = [];
  if (typeof bid.price !== 'bigint' || bid.price < 1n) problems.push('The price must be at least 1 minor unit.');
  else if (bid.price > PRICE_MAX) problems.push('The price is too large.');
  if (!Number.isInteger(bid.deliveryDays) || bid.deliveryDays < 0 || bid.deliveryDays > UINT32_MAX) problems.push('Delivery days must be a whole number, 0 or more.');
  if (!Number.isInteger(bid.compliance) || bid.compliance < 0 || bid.compliance > UINT32_MAX) problems.push('The compliance bitmask must fit in 32 bits.');
  if (noteBytes(bid.note) > NOTE_MAX_BYTES) problems.push(`The note is ${noteBytes(bid.note)} bytes; the limit is ${NOTE_MAX_BYTES}.`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(bid.salt)) problems.push('The salt must be 32 bytes.');
  return problems;
}

function assertValid(bid: Bid): void {
  const problems = validateBid(bid);
  if (problems.length > 0) throw new Error(problems.join(' '));
}

/** 32 bytes from the platform's cryptographic random source. */
export function randomSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** The bytes that are time-locked and later submitted at opening. */
export function encodeBid(bid: Bid): Uint8Array {
  assertValid(bid);
  return hexToBytes(encodeAbiParameters(PLAINTEXT_TYPES, [bid.price, bid.deliveryDays, bid.compliance, bid.note, bid.salt]));
}

/**
 * Parse a decrypted bid. Strict: the bytes must be exactly what encodeBid produces for the result,
 * so one bid has one encoding and anything else is reported as malformed.
 */
export function decodeBid(plaintext: Uint8Array): Bid {
  let decoded: readonly [bigint, number, number, string, Hex];
  try {
    decoded = decodeAbiParameters(PLAINTEXT_TYPES, toHex(plaintext));
  } catch {
    throw new Error('Not a Gavelock bid: the bytes do not decode.');
  }
  const [price, deliveryDays, compliance, note, salt] = decoded;
  const bid: Bid = { price, deliveryDays, compliance, note, salt };
  assertValid(bid);
  const canonical = encodeBid(bid);
  if (canonical.length !== plaintext.length || canonical.some((byte, i) => byte !== plaintext[i])) {
    throw new Error('Not a Gavelock bid: the encoding is not canonical.');
  }
  return bid;
}

/** The value stored on chain when the sealed bid is submitted. */
export function commitmentOf(context: BidContext, bid: Bid): Hex {
  assertValid(bid);
  if (!isAddress(context.contract) || !isAddress(context.bidder)) throw new Error('The tender contract and bidder must be addresses.');
  if (!Number.isInteger(context.chainId) || context.chainId < 1) throw new Error('Bad chain id.');
  if (context.tenderId < 0n) throw new Error('Bad tender id.');
  return keccak256(
    encodeAbiParameters(COMMITMENT_TYPES, [
      BigInt(context.chainId),
      context.contract,
      context.tenderId,
      context.bidder,
      bid.price,
      bid.deliveryDays,
      bid.compliance,
      bid.note,
      bid.salt,
    ]),
  );
}
