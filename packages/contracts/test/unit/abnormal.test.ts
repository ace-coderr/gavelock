// The abnormally low bid rule, checked against the core reference on a plain in-memory chain.
// A test double serves real rule truth tables, so every award here is compared field by field with
// packages/core: price order, median, flags, reference price, each bid's rule input and score, winner.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { NO_GATES, STARTER_RULES, truthTable, type RuleSpec } from "@gavelock/core";
import { CHECKLIST, DEPOSIT, HOUR, deployLocal, type Local, type PlannedBid } from "./local.ts";

const FLOOR = 7000;
const lowestPrice = truthTable(STARTER_RULES[0]!.spec);
// Price 30, first preferred group 40, second preferred group 30: a rule where "quality" can outweigh price.
const qualityLed: RuleSpec = { weights: { price: 30, delivery: 0, panel: 0, preferredA: 40, preferredB: 30 }, gates: NO_GATES };
const qualityTable = truthTable(qualityLed);

const A = 0b00111; // mandatory + first preferred group
const AB = 0b11111; // mandatory + both preferred groups
const priceBand = (ruleInput: number) => ruleInput & 7;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

describe("the abnormally low bid rule", () => {
  let s: Local;

  before(async () => {
    s = await deployLocal();
  });

  /** Ready a tender, finalize it in one call and compare it with the reference. */
  async function settle(plan: PlannedBid[], floor: number, table = lowestPrice) {
    await s.useTable(table);
    const { id } = await s.readyTender(plan, floor);
    await s.finalizePaged(id, [1000]);
    const { award, state } = await s.assertMatchesCore(id, table);
    return { id, award, state };
  }

  // ------------------------------------------------------------------ the attack
  describe("one fake lowball among real bids", () => {
    // Honest: a cheap bid with decent quality. Favoured: expensive, top quality. A third real bid.
    const real: PlannedBid[] = [
      { price: 100_000n, compliance: A },
      { price: 130_000n, compliance: AB },
      { price: 105_000n },
    ];
    const fake: PlannedBid = { price: 1n };

    it("without the rule, flattens every real price band and hands the award to the expensive bid", async () => {
      const honest = await settle(real, 0, qualityTable);
      assert.equal(honest.state.winner, 0);
      assert.deepEqual(honest.state.bids.map((b) => priceBand(b.ruleInput)), [0, 6, 2]);

      const attacked = await settle([...real, fake], 0, qualityTable);
      assert.deepEqual(attacked.state.bids.slice(0, 3).map((b) => priceBand(b.ruleInput)), [7, 7, 7]);
      assert.equal(attacked.state.winner, 1, "the favoured expensive bid wins on quality");
      assert.equal(attacked.state.lowest, "1");
    });

    it("with the rule, changes neither the real bids' bands nor the winner", async () => {
      const honest = await settle(real, FLOOR, qualityTable);
      const defended = await settle([...real, fake], FLOOR, qualityTable);
      assert.equal(defended.state.median, "102500");
      assert.equal(defended.state.lowest, "100000");
      assert.equal(defended.state.lowest, honest.state.lowest);
      assert.deepEqual(defended.state.bids.map((b) => b.abnormallyLow), [false, false, false, true]);
      for (let i = 0; i < 3; i++) {
        assert.equal(defended.state.bids[i]!.ruleInput, honest.state.bids[i]!.ruleInput, `bid ${i}: same rule input`);
        assert.equal(defended.state.bids[i]!.score, honest.state.bids[i]!.score, `bid ${i}: same score`);
      }
      assert.equal(defended.state.winner, honest.state.winner);
      assert.equal(defended.state.winner, 0);
    });

    it("keeps the flagged bid in the tender: eligible, price band 0, publicly flagged", async () => {
      const { state } = await settle([...real, fake], FLOOR, qualityTable);
      const low = state.bids[3]!;
      assert.equal(low.abnormallyLow, true);
      assert.equal(low.eligible, true);
      assert.equal(priceBand(low.ruleInput), 0);
      // On a pure price rule it ties the best real bid on score and wins the tie on price.
      const pure = await settle([...real, fake], FLOOR, lowestPrice);
      assert.equal(pure.state.winner, 3);
      assert.equal(pure.state.bids[3]!.abnormallyLow, true);
    });
  });

  // ------------------------------------------------------------------ the floor
  it("lets a genuinely cheaper bid just above the floor set the reference price", async () => {
    const { state } = await settle([{ price: 1000n }, { price: 1000n }, { price: 1100n }, { price: 720n }], FLOOR);
    assert.equal(state.median, "1000");
    assert.equal(state.lowest, "720");
    assert.deepEqual(state.bids.map((b) => b.abnormallyLow), [false, false, false, false]);
    assert.equal(state.winner, 3);
    assert.equal(priceBand(state.bids[0]!.ruleInput), 6);
  });

  it("does not flag a bid exactly on the floor, and flags one a single unit below", async () => {
    const on = await settle([{ price: 1000n }, { price: 1000n }, { price: 1000n }, { price: 700n }], FLOOR);
    assert.equal(on.state.bids[3]!.abnormallyLow, false);
    assert.equal(on.state.lowest, "700");
    const below = await settle([{ price: 1000n }, { price: 1000n }, { price: 1000n }, { price: 699n }], FLOOR);
    assert.equal(below.state.bids[3]!.abnormallyLow, true);
    assert.equal(below.state.lowest, "1000");
    // The comparison is exact where a division would round: 70% of 1001 is 700.7.
    const exact = await settle([{ price: 1001n }, { price: 1001n }, { price: 1001n }, { price: 700n }, { price: 701n }], FLOOR);
    assert.deepEqual(exact.state.bids.map((b) => b.abnormallyLow), [false, false, false, true, false]);
    assert.equal(exact.state.lowest, "701");
  });

  // ------------------------------------------------------------------ counts
  it("is skipped with one or two compliant bids", async () => {
    const one = await settle([{ price: 1n }], FLOOR);
    assert.deepEqual([one.state.median, one.state.lowest, one.state.compliantCount], ["0", "1", 1]);
    const two = await settle([{ price: 1n }, { price: 1000n }], FLOOR);
    assert.deepEqual([two.state.median, two.state.lowest, two.state.compliantCount], ["0", "1", 2]);
    assert.deepEqual(two.state.bids.map((b) => b.abnormallyLow), [false, false]);
    // A third bid that fails the checklist does not make three.
    const twoPlus = await settle([{ price: 1n }, { price: 1000n }, { price: 1000n, compliance: 0 }], FLOOR);
    assert.deepEqual([twoPlus.state.median, twoPlus.state.lowest, twoPlus.state.compliantCount], ["0", "1", 2]);
    // Nor does one that was never opened.
    const unopened = await settle([{ price: 1n }, { price: 1000n }, { price: 1000n, unopened: true }], FLOOR);
    assert.deepEqual([unopened.state.median, unopened.state.lowest, unopened.state.compliantCount], ["0", "1", 2]);
  });

  it("applies from three compliant bids, with odd and even counts", async () => {
    const three = await settle([{ price: 1n }, { price: 1000n }, { price: 1100n }], FLOOR);
    assert.deepEqual([three.state.median, three.state.lowest], ["1000", "1000"]);
    assert.deepEqual(three.state.bids.map((b) => b.abnormallyLow), [true, false, false]);
    const four = await settle([{ price: 1n }, { price: 1000n }, { price: 1100n }, { price: 1200n }], FLOOR);
    assert.deepEqual([four.state.median, four.state.lowest], ["1050", "1000"]);
    const five = await settle([{ price: 1n }, { price: 2n }, { price: 1100n }, { price: 1200n }, { price: 1300n }], FLOOR);
    assert.deepEqual([five.state.median, five.state.lowest], ["1100", "1100"]);
    assert.deepEqual(five.state.bids.map((b) => b.abnormallyLow), [true, true, false, false, false]);
    // An even count whose two middle prices have an odd sum: the mean is rounded down.
    const rounded = await settle([{ price: 900n }, { price: 1001n }, { price: 2000n }, { price: 800n }], FLOOR);
    assert.equal(rounded.state.median, "950");
  });

  it("flags nothing when every price is equal, and the earliest bid wins", async () => {
    const { state } = await settle([{ price: 500n }, { price: 500n }, { price: 500n }, { price: 500n }], FLOOR);
    assert.deepEqual([state.median, state.lowest, state.winner], ["500", "500", 0]);
    assert.deepEqual(state.bids.map((b) => b.abnormallyLow), [false, false, false, false]);
  });

  it("is off when the floor is 0, and strictest at 10,000", async () => {
    const plan = [{ price: 1n }, { price: 1000n }, { price: 1100n }, { price: 1200n }];
    const off = await settle(plan, 0);
    assert.deepEqual([off.state.median, off.state.lowest], ["0", "1"]);
    assert.deepEqual(off.state.bids.map((b) => b.abnormallyLow), [false, false, false, false]);
    assert.deepEqual(off.state.bids.slice(1).map((b) => priceBand(b.ruleInput)), [7, 7, 7]);
    const strict = await settle(plan, 10_000);
    assert.deepEqual([strict.state.median, strict.state.lowest], ["1050", "1100"]);
    assert.deepEqual(strict.state.bids.map((b) => b.abnormallyLow), [true, true, false, false]);
  });

  it("never flags or counts a bid that fails the checklist", async () => {
    const { state } = await settle([{ price: 1n, compliance: 0b00001 }, { price: 1000n }, { price: 1050n }, { price: 1100n }], FLOOR);
    assert.deepEqual([state.median, state.lowest, state.compliantCount], ["1050", "1000", 3]);
    assert.equal(state.bids[0]!.abnormallyLow, false);
    assert.equal(state.bids[0]!.eligible, false);
  });

  // ------------------------------------------------------------------ disqualification
  it("recomputes the median, the flags and the reference when a challenge is upheld", async () => {
    await s.useTable(lowestPrice);
    const { id } = await s.readyTender([{ price: 650n }, { price: 900n }, { price: 1000n }, { price: 1100n }], FLOOR);
    await s.finalizePaged(id, [2]);
    let { state } = await s.assertMatchesCore(id, lowestPrice);
    assert.deepEqual([state.median, state.lowest], ["950", "900"]);
    assert.deepEqual(state.bids.map((b) => b.abnormallyLow), [true, false, false, false]); // 650 < 70% of 950

    await s.mined(await s.gavelock.write.challenge([id, 3n, 0, "False claim."], { account: s.stranger.account, value: DEPOSIT }));
    await s.mined(await s.gavelock.write.rule([id, 0n, true, "Confirmed."], { account: s.buyer.account }));
    const pending = await s.awardState(id);
    assert.deepEqual([pending.winner, pending.median, pending.lowest, pending.generation, pending.compliantCount], [null, "0", "0", 1, 3]);
    assert.deepEqual(await s.priceOrder(id), [0, 1, 2], "the disqualified bid left the price order");

    // The recompute is paged like the first computation: replay it with several page sizes.
    let reference: Awaited<ReturnType<Local["awardState"]>> | null = null;
    for (const pages of [[1], [2], [3, 1], [100]]) {
      const snapshot = await s.test.snapshot();
      await s.finalizePaged(id, pages, [s.other, s.buyer, s.stranger]);
      const result = await s.awardState(id);
      if (reference === null) reference = result;
      assert.deepEqual(result, reference, `pages ${JSON.stringify(pages)}`);
      await s.test.revert({ id: snapshot });
    }
    await s.finalizePaged(id, [1]);
    ({ state } = await s.assertMatchesCore(id, lowestPrice));
    assert.deepEqual(state, reference);
    assert.deepEqual([state.median, state.lowest, state.winner], ["900", "650", 0]); // 650 >= 70% of 900: no longer flagged
    assert.deepEqual(state.bids.slice(0, 3).map((b) => b.abnormallyLow), [false, false, false]);
    assert.equal(priceBand(state.bids[1]!.ruleInput), 6, "900 is re-banded against the new reference");

    // Disqualify once more: two compliant bids left, so the rule switches off altogether.
    await s.mined(await s.gavelock.write.challenge([id, 2n, 0, "False claim."], { account: s.stranger.account, value: DEPOSIT }));
    await s.mined(await s.gavelock.write.rule([id, 1n, true, "Confirmed."], { account: s.buyer.account }));
    await s.finalizePaged(id, [1]);
    ({ state } = await s.assertMatchesCore(id, lowestPrice));
    assert.deepEqual([state.median, state.lowest, state.compliantCount, state.generation], ["0", "650", 2, 2]);
  });

  it("recomputes when the disqualified bid is the cheapest, the median, or the flagged one", async () => {
    await s.useTable(lowestPrice);
    for (const target of [0, 2, 4]) {
      const { id } = await s.readyTender([{ price: 300n }, { price: 900n }, { price: 1000n }, { price: 1100n }, { price: 250n }], FLOOR, { hints: "exact" });
      await s.finalizePaged(id, [3]);
      await s.assertMatchesCore(id, lowestPrice);
      await s.mined(await s.gavelock.write.challenge([id, BigInt(target), 1, "Seal mismatch."], { account: s.stranger.account, value: DEPOSIT }));
      await s.mined(await s.gavelock.write.rule([id, 0n, true, "Confirmed."], { account: s.buyer.account }));
      await s.finalizePaged(id, [2], [s.other, s.stranger]);
      const { state } = await s.assertMatchesCore(id, lowestPrice);
      assert.equal(state.bids[target]!.disqualified, true);
      assert.equal(state.bids[target]!.scoredIn, 1, "a disqualified bid is not scored again");
    }
  });

  // ------------------------------------------------------------------ paging
  it("gives the same award for every page size and caller, on random tenders, equal to the reference", async () => {
    const next = rng(20261117);
    const plans: number[][] = [[1000], [1], [2], [3], [5], [1, 2, 3, 4, 1000], [7, 1]];
    for (let trial = 0; trial < 14; trial++) {
      const count = 1 + (next() % 12);
      const plan: PlannedBid[] = Array.from({ length: count }, () => ({
        price: BigInt(next() % 6 === 0 ? 1 + (next() % 60) : 900 + (next() % 9) * 45),
        days: next() % 40,
        compliance: next() % 7 === 0 ? 0b00001 : 0b00011 | ((next() % 8) << 2),
        unopened: next() % 11 === 0,
      }));
      const floor = [0, 5000, 7000, 10_000][next() % 4]!;
      const table = next() % 2 === 0 ? lowestPrice : qualityTable;
      await s.useTable(table);
      const openOrder = plan.map((_, n) => n).sort(() => (next() % 2 === 0 ? 1 : -1));
      const { id } = await s.readyTender(plan, floor, { hints: (["none", "exact", "stale"] as const)[next() % 3], openOrder });

      let first: Awaited<ReturnType<Local["awardState"]>> | null = null;
      for (const [k, pages] of plans.entries()) {
        const snapshot = await s.test.snapshot();
        await s.finalizePaged(id, pages, k % 2 === 0 ? [s.stranger] : [s.buyer, s.other, s.stranger]);
        const result = await s.awardState(id);
        if (first === null) first = result;
        assert.deepEqual(result, first, `trial ${trial}, pages ${JSON.stringify(pages)}`);
        await s.test.revert({ id: snapshot });
      }
      await s.finalizePaged(id, [4]);
      const state = await s.awardState(id);
      assert.deepEqual(state, first, `trial ${trial}`);
      if (!state.cancelled) await s.assertMatchesCore(id, table);
    }
  });

  it("pages every stage: a call that stops inside the median walk or the low prefix leaves no award", async () => {
    await s.useTable(lowestPrice);
    // Eleven compliant bids, four of them below the floor: the walk to the median takes 5 steps, the prefix 4.
    const plan: PlannedBid[] = [10n, 20n, 30n, 40n, 1000n, 1000n, 1000n, 1100n, 1100n, 1200n, 1300n].map((price) => ({ price }));
    const { id } = await s.readyTender(plan, FLOOR, { hints: "exact" });
    const stageAfter = async (page: number) => {
      await s.mined(await s.gavelock.write.finalize([id, BigInt(page)], { account: s.stranger.account }));
      const t = await s.gavelock.read.getTender([id]);
      return { stage: t.stage, walkPos: t.walkPos, median: t.medianPrice.toString(), lowest: t.lowestValidPrice.toString(), scoreCursor: t.scoreCursor, awarded: t.awardedAt !== 0n };
    };
    assert.deepEqual(await stageAfter(3), { stage: 1, walkPos: 3, median: "0", lowest: "0", scoreCursor: 0, awarded: false });
    assert.deepEqual(await stageAfter(2), { stage: 2, walkPos: 5, median: "1000", lowest: "0", scoreCursor: 0, awarded: false });
    assert.deepEqual(await stageAfter(3), { stage: 2, walkPos: 5, median: "1000", lowest: "0", scoreCursor: 0, awarded: false });
    // One more step passes the fourth flagged bid; the reference is only found when the next bid is looked at.
    assert.deepEqual(await stageAfter(1), { stage: 2, walkPos: 5, median: "1000", lowest: "0", scoreCursor: 0, awarded: false });
    assert.deepEqual(await stageAfter(10), { stage: 3, walkPos: 5, median: "1000", lowest: "1000", scoreCursor: 10, awarded: false });
    assert.equal((await stageAfter(1)).awarded, true);
    const { state } = await s.assertMatchesCore(id, lowestPrice);
    assert.deepEqual(state.bids.map((b) => b.abnormallyLow), [true, true, true, true, false, false, false, false, false, false, false]);
  });

  // ------------------------------------------------------------------ hints
  it("builds the same price order whatever hints the openers give", async () => {
    await s.useTable(lowestPrice);
    const plan: PlannedBid[] = [900n, 500n, 900n, 700n, 500n, 1200n, 100n, 900n].map((price) => ({ price }));
    const orders: number[][] = [];
    for (const hints of ["none", "exact", "stale"] as const) {
      for (const openOrder of [undefined, [7, 6, 5, 4, 3, 2, 1, 0], [3, 0, 6, 2, 7, 1, 5, 4]]) {
        const { id } = await s.readyTender(plan, FLOOR, { hints, openOrder });
        orders.push(await s.priceOrder(id));
      }
    }
    for (const order of orders) assert.deepEqual(order, [6, 1, 4, 3, 0, 2, 7, 5]); // by price, then by bid index
  });

  it("rejects a hint that is not a listed bid sorting before the new one", async () => {
    await s.useTable(lowestPrice);
    // Bids: 0 = 1000, 1 = 500, 2 = 800 (to be opened last), 3 = fails the checklist, 4 = never opened.
    const plan: PlannedBid[] = [{ price: 1000n }, { price: 500n }, { price: 800n }, { price: 600n, compliance: 0 }, { price: 400n, unopened: true }];
    const { id, params } = await s.createTender(FLOOR).then(async (created) => {
      await s.warpTo(created.params.biddingStart);
      for (const [n, planned] of plan.entries()) {
        const who = await s.bidder(n);
        const { commitmentOf } = await import("@gavelock/core");
        const commitment = commitmentOf({ chainId: s.chainId, contract: s.gavelock.address, tenderId: created.id, bidder: who.account.address }, s.bidOf(planned, n));
        await s.mined(await s.gavelock.write.submitBid([created.id, commitment, "0x01"], { account: who.account, value: 10n ** 16n }));
      }
      await s.warpTo(created.params.deadline);
      return created;
    });
    const open = (n: number, hint: number) => {
      const b = s.bidOf(plan[n]!, n);
      return s.gavelock.write.openBid([id, BigInt(n), b.price, b.deliveryDays, b.compliance, b.note, b.salt, BigInt(hint)], { account: s.stranger.account });
    };
    const refused = async (n: number, hint: number) => {
      try {
        await s.gavelock.simulate.openBid([id, BigInt(n), s.bidOf(plan[n]!, n).price, 10, s.bidOf(plan[n]!, n).compliance, "", s.bidOf(plan[n]!, n).salt, BigInt(hint)], { account: s.stranger.account });
      } catch (error) {
        return String((error as Error).message).includes("BadHint");
      }
      return false;
    };
    await s.mined(await open(0, 0));
    await s.mined(await open(1, 0));
    await s.mined(await open(3, 0)); // fails the checklist: opened, but never listed
    assert.equal(await refused(2, 1), true, "bid 0 (1000) does not sort before 800");
    assert.equal(await refused(2, 3), true, "a bid cannot be its own hint");
    assert.equal(await refused(2, 4), true, "bid 3 fails the checklist, so it is not in the list");
    assert.equal(await refused(2, 5), true, "bid 4 has not been opened");
    assert.equal(await refused(2, 6), true, "there is no bid 5");
    assert.equal(await refused(2, 2), false, "bid 1 (500) sorts before 800");
    await s.mined(await open(2, 2));
    assert.deepEqual(await s.priceOrder(id), [1, 2, 0]);
    // A bid that fails the checklist is not listed, so its hint is ignored rather than checked.
    void params;
    void HOUR;
    void CHECKLIST;
  });
});
