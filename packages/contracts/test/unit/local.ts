// A whole Gavelock system on a plain in-memory chain, with a test double in place of TapeOut.
// The double can serve a real rule's truth table, so awards can be compared with the core reference
// without any network access.
import assert from "node:assert/strict";
import { network } from "hardhat";
import { bytesToHex, parseEther, type Address, type Hex } from "viem";
import { DEFAULT_LADDERS, commitmentOf, compliantOrder, computeAward, openingHint, type Bid, type Checklist, type OpenedBid, type TruthTable } from "@gavelock/core";

export const HOUR = 3600;
export const DEPOSIT = parseEther("0.01");
export const CHECKLIST: Checklist = { items: 5, mandatoryMask: 0b00011, preferredAMask: 0b00100, preferredBMask: 0b11000 };

export interface PlannedBid {
  price: bigint;
  days?: number;
  compliance?: number;
  /** Leave the bid sealed through the opening window. */
  unopened?: boolean;
}

export async function deployLocal() {
  const { viem } = await network.create();
  const pub = await viem.getPublicClient();
  const test = await viem.getTestClient();
  const wallets = (await viem.getWalletClients()) as any[];
  const [, feeRecipient, buyer, stranger, other] = wallets;
  const chainId = await pub.getChainId();

  const mock = (await viem.deployContract("MockRuleSource")) as any;
  const engine = (await viem.deployContract("AwardEngine")) as any;
  const gavelock = (await viem.deployContract("Gavelock", [mock.address, feeRecipient.account.address, 0n], {
    libraries: { "project/contracts/AwardEngine.sol:AwardEngine": engine.address },
  } as never)) as any;

  const mined = async (hash: Hex) => {
    const receipt = await pub.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt;
  };
  const chainNow = async () => Number((await pub.getBlock()).timestamp);
  const warpTo = async (timestamp: number | bigint) => {
    const current = await chainNow();
    await test.setNextBlockTimestamp({ timestamp: BigInt(Math.max(Number(timestamp), current + 1)) });
    await test.mine({ blocks: 1 });
  };

  /** A funded account at a made-up address, for tenders with more bidders than the chain has keys. */
  const bidders = new Map<number, any>();
  async function bidder(n: number) {
    let wallet = bidders.get(n);
    if (!wallet) {
      const address = `0x${(0xb1d0000 + n).toString(16).padStart(40, "0")}` as Address;
      await test.impersonateAccount({ address });
      await test.setBalance({ address, value: parseEther("10") });
      wallet = await viem.getWalletClient(address);
      bidders.set(n, wallet);
    }
    return wallet;
  }

  const useTable = async (table: TruthTable) => mined(await mock.write.setTable([bytesToHex(table)]));

  async function createTender(abnormalFloorBps: number, checklist: Checklist = CHECKLIST) {
    const now = (await chainNow()) + 10;
    const params = {
      quick: false,
      ruleId: 1,
      clarificationsStart: 0n,
      biddingStart: BigInt(now + HOUR),
      deadline: BigInt(now + 2 * HOUR),
      openingWindow: HOUR,
      commitWindow: 0,
      revealWindow: 0,
      standstill: HOUR,
      bidDeposit: DEPOSIT,
      checklistItems: checklist.items,
      mandatoryMask: checklist.mandatoryMask,
      preferredAMask: checklist.preferredAMask,
      preferredBMask: checklist.preferredBMask,
      priceLadderBps: [...DEFAULT_LADDERS.priceBps],
      deliveryLadderDays: [...DEFAULT_LADDERS.deliveryDays],
      abnormalFloorBps,
      panel: [],
      quorum: 0,
      terms: "0x7b7d",
    };
    const { result: id } = await gavelock.simulate.createTender([params], { account: buyer.account });
    await mined(await gavelock.write.createTender([params], { account: buyer.account }));
    return { id: id as bigint, params };
  }

  const saltOf = (n: number) => `0x${(n + 1).toString(16).padStart(64, "0")}` as Hex;
  const bidOf = (b: PlannedBid, n: number): Bid => ({ price: b.price, deliveryDays: b.days ?? 10, compliance: b.compliance ?? 0b00011, note: "", salt: saltOf(n) });

  /** The chain's opened bids, in the shape the core reference takes. */
  async function openedBids(id: bigint): Promise<OpenedBid[]> {
    const count = Number(await gavelock.read.bidCount([id]));
    const out: OpenedBid[] = [];
    for (let i = 0; i < count; i++) {
      const b = await gavelock.read.getBid([id, BigInt(i)]);
      if (b.opened) out.push({ index: i, price: b.price, deliveryDays: b.deliveryDays, compliance: b.compliance, disqualified: b.disqualified, panelMedian: null });
    }
    return out;
  }

  type HintStyle = "none" | "exact" | "stale";
  /**
   * Create a tender, submit the planned bids, open them and move to the point where finalize may run.
   * `hints` chooses how each opening locates its place in the price order: no hint (the contract searches
   * from the cheapest), the exact predecessor, or a deliberately out-of-date earlier position.
   * `openOrder` lets a test open bids in an order other than the order they were submitted in.
   */
  async function readyTender(plan: PlannedBid[], abnormalFloorBps: number, options: { hints?: HintStyle; openOrder?: number[]; checklist?: Checklist } = {}) {
    const checklist = options.checklist ?? CHECKLIST;
    const { id, params } = await createTender(abnormalFloorBps, checklist);
    await warpTo(params.biddingStart);
    for (const [n, planned] of plan.entries()) {
      const who = await bidder(n);
      const commitment = commitmentOf({ chainId, contract: gavelock.address, tenderId: id, bidder: who.account.address }, bidOf(planned, n));
      await mined(await gavelock.write.submitBid([id, commitment, "0x01"], { account: who.account, value: DEPOSIT }));
    }
    await warpTo(params.deadline);
    const order = options.openOrder ?? plan.map((_, n) => n);
    let openGas = 0n;
    for (const n of order) {
      const planned = plan[n]!;
      if (planned.unopened) continue;
      const bid = bidOf(planned, n);
      let hint = 0;
      if (options.hints && options.hints !== "none") {
        const already = await openedBids(id);
        hint = openingHint(already, { index: n, price: bid.price }, checklist);
        if (options.hints === "stale" && hint !== 0) {
          // Any earlier listed bid is a valid hint: use the cheapest one instead of the true predecessor.
          hint = compliantOrder(already, checklist)[0]!.index + 1;
        }
      }
      const receipt = await mined(await gavelock.write.openBid([id, BigInt(n), bid.price, bid.deliveryDays, bid.compliance, bid.note, bid.salt, BigInt(hint)], { account: stranger.account }));
      openGas += receipt.gasUsed;
    }
    await warpTo(params.deadline + BigInt(HOUR));
    return { id, params, openGas };
  }

  /** Run finalize with the given page sizes (the last repeats) until the tender is awarded or ended. */
  async function finalizePaged(id: bigint, pages: number[], callers: any[] = [stranger]) {
    let calls = 0;
    let totalGas = 0n;
    let maxGas = 0n;
    for (;;) {
      const page = pages[Math.min(calls, pages.length - 1)]!;
      const receipt = await mined(await gavelock.write.finalize([id, BigInt(page)], { account: callers[calls % callers.length].account }));
      totalGas += receipt.gasUsed;
      if (receipt.gasUsed > maxGas) maxGas = receipt.gasUsed;
      calls++;
      const t = await gavelock.read.getTender([id]);
      if (t.awardedAt !== 0n || t.cancelled) return { calls, totalGas, maxGas };
      assert.ok(calls < 400, "finalize does not terminate");
    }
  }

  /** Everything the award computation left on chain, in a form that can be compared between runs. */
  async function awardState(id: bigint) {
    const t = await gavelock.read.getTender([id]);
    const count = Number(await gavelock.read.bidCount([id]));
    const bids = [];
    for (let i = 0; i < count; i++) {
      const b = await gavelock.read.getBid([id, BigInt(i)]);
      bids.push({ opened: b.opened, disqualified: b.disqualified, ruleInput: b.ruleInput, score: b.score, eligible: b.eligible, abnormallyLow: b.abnormallyLow, scoredIn: b.scoredIn });
    }
    return {
      cancelled: t.cancelled as boolean,
      winner: t.best === 0 ? null : t.best - 1,
      bestScore: t.bestScore as number,
      median: (t.medianPrice as bigint).toString(),
      lowest: (t.lowestValidPrice as bigint).toString(),
      compliantCount: t.compliantCount as number,
      generation: t.generation as number,
      bids,
    };
  }

  /** The price-ordered list as the contract holds it: bid indices from the cheapest up. */
  async function priceOrder(id: bigint) {
    const t = await gavelock.read.getTender([id]);
    const order: number[] = [];
    let previous = 0;
    for (let node = t.head as number; node !== 0; ) {
      const b = await gavelock.read.getBid([id, BigInt(node - 1)]);
      assert.equal(b.prev, previous, "back link");
      order.push(node - 1);
      previous = node;
      node = b.next;
      assert.ok(order.length <= 10_000);
    }
    assert.equal(order.length, t.compliantCount, "compliantCount matches the list");
    return order;
  }

  /** Compare what the contract computed with the core reference, field by field. */
  async function assertMatchesCore(id: bigint, table: TruthTable, checklist: Checklist = CHECKLIST) {
    const t = await gavelock.read.getTender([id]);
    const opened = await openedBids(id);
    const award = computeAward(opened, DEFAULT_LADDERS, checklist, table, t.abnormalFloorBps);
    const state = await awardState(id);
    assert.deepEqual(await priceOrder(id), compliantOrder(opened, checklist).map((b) => b.index), "price order");
    assert.equal(state.compliantCount, award.compliantBids, "compliant bids");
    assert.equal(state.median, (award.medianPrice ?? 0n).toString(), "median price");
    assert.equal(state.lowest, (award.lowestValidPrice ?? 0n).toString(), "reference price");
    assert.equal(state.winner, award.winner, "winner");
    for (const scored of award.scored) {
      const b = state.bids[scored.index]!;
      assert.equal(b.ruleInput, scored.input, `bid ${scored.index}: rule input`);
      assert.equal(b.score, scored.outcome.score, `bid ${scored.index}: score`);
      assert.equal(b.eligible, scored.outcome.eligible, `bid ${scored.index}: eligible`);
      assert.equal(b.abnormallyLow, scored.abnormallyLow, `bid ${scored.index}: abnormally low flag`);
    }
    return { award, state };
  }

  return { viem, pub, test, wallets, buyer, stranger, other, feeRecipient, chainId, mock, engine, gavelock, mined, chainNow, warpTo, bidder, useTable, createTender, readyTender, finalizePaged, awardState, priceOrder, openedBids, assertMatchesCore, bidOf };
}

export type Local = Awaited<ReturnType<typeof deployLocal>>;
