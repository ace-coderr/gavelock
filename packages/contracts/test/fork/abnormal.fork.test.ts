// The abnormally low bid rule against the real TapeOut circuits on a fork of X Layer mainnet:
// the lowball attack on a quality-weighted rule with a real panel, paged replays with the rule on,
// a recompute after a disqualification that changes the median, and the gas the rule adds.
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { bytesToHex, formatEther, type Hex } from "viem";
import { openingHint, type OpenedBid } from "@gavelock/core";
import { CHECKLIST, GAS_PRICE, deploySystem, type RuleKey, type System } from "./system.ts";

const salt = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const priceBand = (ruleInput: number) => ruleInput & 7;

interface Planned {
  price: bigint;
  days?: number;
  compliance?: number;
  unopened?: boolean;
  /** Panel score every member gives this bid. */
  quality?: number;
}

describe("the abnormally low bid rule on a fork of X Layer", () => {
  let s: System;
  let buyer: any, p1: any, p2: any, p3: any, stranger: any;
  const gasRows: { case: string; gas: string; okb: string }[] = [];

  before(async () => {
    s = await deploySystem();
    const w = s.wallets as any[];
    [buyer, p1, p2, p3, stranger] = [w[2], w[3], w[4], w[5], w[18]];
  });

  after(() => {
    console.table(gasRows);
    fs.mkdirSync(new URL("../../reports/", import.meta.url), { recursive: true });
    fs.writeFileSync(new URL("../../reports/gas-abnormal-rule.json", import.meta.url), JSON.stringify({ gasPriceWei: GAS_PRICE.toString(), rows: gasRows }, null, 2) + "\n");
  });

  /** Create a tender, take the planned bids through opening (and the panel, if any), up to the point where finalize may run. */
  async function ready(plan: Planned[], options: { rule: RuleKey; floor: number; panel?: boolean; exactHints?: boolean }) {
    const members = options.panel ? [p1, p2, p3] : [];
    const { id, t, rule } = await s.createTender({ buyer, rule: options.rule, panel: members, quorum: members.length ? 2 : 0, abnormalFloorBps: options.floor });
    await s.warpTo(Number(t.biddingStart));
    const sealed = [];
    for (const [n, b] of plan.entries()) {
      sealed.push(await s.submitBid(id, await s.extraBidder(n), { price: b.price, deliveryDays: b.days ?? 10, compliance: b.compliance ?? 0b00011 }));
    }
    await s.warpTo(Number(t.deadline));
    const opened: OpenedBid[] = [];
    let openGas = 0n;
    for (const [n, b] of plan.entries()) {
      if (b.unopened) continue;
      const hint = options.exactHints ? openingHint(opened, { index: n, price: b.price }, CHECKLIST) : 0;
      const receipt = await s.mined(await s.openBid(id, sealed[n]!, stranger, BigInt(hint)));
      openGas += receipt.gasUsed;
      opened.push({ index: n, price: b.price, deliveryDays: b.days ?? 10, compliance: b.compliance ?? 0b00011, disqualified: false, panelMedian: null });
    }
    await s.warpTo(Number(t.openingEnd));
    if (members.length) {
      const scores = plan.map((b) => b.quality ?? 0);
      for (const [k, member] of members.entries()) {
        await s.mined(await s.panel.write.commitScores([id, s.scoreCommitment(id, member.account.address, scores, salt(40 + k))], { account: member.account }));
      }
      await s.warpTo(Number(t.commitEnd));
      for (const [k, member] of members.entries()) {
        await s.mined(await s.panel.write.revealScores([id, bytesToHex(Uint8Array.from(scores)), salt(40 + k)], { account: member.account }));
      }
      await s.warpTo(Number(t.revealEnd));
    }
    return { id, rule, openGas };
  }

  async function finalizePaged(id: bigint, pages: number[], callers: any[] = [stranger]) {
    let calls = 0;
    let totalGas = 0n;
    let maxGas = 0n;
    for (;;) {
      const page = pages[Math.min(calls, pages.length - 1)]!;
      const receipt = await s.mined(await s.gavelock.write.finalize([id, BigInt(page)], { account: callers[calls % callers.length].account }));
      totalGas += receipt.gasUsed;
      if (receipt.gasUsed > maxGas) maxGas = receipt.gasUsed;
      calls++;
      const t = await s.gavelock.read.getTender([id]);
      if (t.awardedAt !== 0n || t.cancelled) return { calls, totalGas, maxGas };
      assert.ok(calls < 400, "finalize does not terminate");
    }
  }

  async function state(id: bigint, count: number) {
    const t = await s.gavelock.read.getTender([id]);
    const bids = [];
    for (let i = 0; i < count; i++) {
      const b = await s.gavelock.read.getBid([id, BigInt(i)]);
      bids.push({ ruleInput: b.ruleInput, score: b.score, eligible: b.eligible, abnormallyLow: b.abnormallyLow, disqualified: b.disqualified, scoredIn: b.scoredIn, panelMedian: b.panelMedian });
    }
    return { winner: t.best === 0 ? null : t.best - 1, median: t.medianPrice.toString(), lowest: t.lowestValidPrice.toString(), compliantCount: t.compliantCount, generation: t.generation, bids };
  }

  /** Compare the chain with the core reference, built from the chain's own opened bids and revealed scores. */
  async function assertMatchesCore(id: bigint, rule: { table: Uint8Array }) {
    const { award, chain, t } = await s.referenceAward(id, rule.table);
    assert.equal(t.best === 0 ? null : t.best - 1, award.winner, "winner");
    assert.equal(t.medianPrice, award.medianPrice ?? 0n, "median price");
    assert.equal(t.lowestValidPrice, award.lowestValidPrice ?? 0n, "reference price");
    assert.equal(t.compliantCount, award.compliantBids, "compliant bids");
    for (const scored of award.scored) {
      const b = chain[scored.index];
      assert.equal(b.ruleInput, scored.input, `bid ${scored.index}: rule input`);
      assert.equal(b.score, scored.outcome.score, `bid ${scored.index}: score`);
      assert.equal(b.eligible, scored.outcome.eligible, `bid ${scored.index}: eligible`);
      assert.equal(b.abnormallyLow, scored.abnormallyLow, `bid ${scored.index}: abnormally low flag`);
    }
    return award;
  }

  // ==================================================================================== the attack
  describe("one fake lowball against a quality-weighted circuit and a real panel", () => {
    // Honest: cheap, decent quality. Favoured: expensive, top quality. A third real bid. Then the fake.
    const real: Planned[] = [
      { price: 100_000n, quality: 55 },
      { price: 130_000n, quality: 95 },
      { price: 105_000n, quality: 30 },
    ];
    const fake: Planned = { price: 1n, quality: 0 };
    let honest: Awaited<ReturnType<typeof state>>;

    it("without the fake, the cheaper bid wins", async () => {
      const { id, rule } = await ready(real, { rule: "quality-70-price-30", floor: 7000, panel: true });
      await finalizePaged(id, [100]);
      await assertMatchesCore(id, rule);
      honest = await state(id, 3);
      assert.equal(honest.winner, 0);
      assert.deepEqual(honest.bids.map((b) => priceBand(b.ruleInput)), [0, 6, 2]);
    });

    it("with the rule off, the fake flattens every real price band and the expensive bid wins", async () => {
      const { id, rule } = await ready([...real, fake], { rule: "quality-70-price-30", floor: 0, panel: true });
      await finalizePaged(id, [100]);
      await assertMatchesCore(id, rule);
      const attacked = await state(id, 4);
      assert.deepEqual(attacked.bids.slice(0, 3).map((b) => priceBand(b.ruleInput)), [7, 7, 7]);
      assert.equal(attacked.winner, 1, "the attack works without the rule");
    });

    it("with the rule on, the fake changes neither the real bids' bands nor the winner", async () => {
      const { id, rule } = await ready([...real, fake], { rule: "quality-70-price-30", floor: 7000, panel: true });
      await finalizePaged(id, [2], [stranger, buyer]);
      await assertMatchesCore(id, rule);
      const defended = await state(id, 4);
      assert.equal(defended.median, "102500");
      assert.equal(defended.lowest, "100000");
      assert.deepEqual(defended.bids.map((b) => b.abnormallyLow), [false, false, false, true]);
      for (let i = 0; i < 3; i++) {
        assert.equal(defended.bids[i]!.ruleInput, honest.bids[i]!.ruleInput, `bid ${i}: same rule input as without the fake`);
        assert.equal(defended.bids[i]!.score, honest.bids[i]!.score, `bid ${i}: same score as without the fake`);
      }
      assert.equal(defended.winner, honest.winner);
      assert.equal(defended.bids[3]!.eligible, true, "the flagged bid stays in the tender");
      assert.equal(priceBand(defended.bids[3]!.ruleInput), 0);
    });
  });

  // ==================================================================================== paging and recompute
  describe("paged finalize with the rule on", () => {
    const plan: Planned[] = [
      { price: 120_000n, quality: 50 },
      { price: 100_000n, quality: 90 },
      { price: 40n, quality: 10 }, // lowball
      { price: 101_000n, quality: 70 },
      { price: 150_000n, unopened: true },
      { price: 100_000n, quality: 90 }, // ties bid 1 exactly
      { price: 9n, compliance: 0b00001, quality: 100 }, // fails the checklist: never counted, never flagged
      { price: 110_000n, quality: 60 },
      { price: 65_000n, quality: 20 }, // below 70% of the median
      { price: 125_000n, quality: 95 },
      { price: 12n, quality: 5 }, // lowball
      { price: 104_000n, quality: 40 },
    ];
    let id: bigint;
    let rule: { table: Uint8Array };

    before(async () => {
      ({ id, rule } = await ready(plan, { rule: "price-60-quality-40", floor: 7000, panel: true, exactHints: true }));
    });

    it("gives the same award for every page size and caller, equal to the reference", async () => {
      let first: Awaited<ReturnType<typeof state>> | null = null;
      for (const [k, pages] of [[100], [1], [2], [3], [5], [4, 1, 100], [7, 2]].entries()) {
        const snapshot = await s.test.snapshot();
        const { calls, maxGas } = await finalizePaged(id, pages, k % 2 === 0 ? [stranger] : [buyer, p1, stranger]);
        const result = await state(id, plan.length);
        console.log(`        pages ${JSON.stringify(pages)}: ${calls} call(s), largest ${maxGas} gas`);
        if (first === null) first = result;
        assert.deepEqual(result, first, `pages ${JSON.stringify(pages)} changed the award`);
        await s.test.revert({ id: snapshot });
      }
      await finalizePaged(id, [3], [stranger, buyer]);
      const award = await assertMatchesCore(id, rule);
      const result = await state(id, plan.length);
      assert.deepEqual(result, first);
      assert.equal(award.compliantBids, 10);
      // Compliant prices: 12, 40, 65000, 100000, 100000, 101000, 104000, 110000, 120000, 125000.
      assert.equal(result.median, "100500");
      assert.equal(result.lowest, "100000");
      assert.deepEqual(result.bids.map((b, i) => (b.abnormallyLow ? i : -1)).filter((i) => i >= 0), [2, 8, 10]);
      assert.equal(result.winner, 1, "bids 1 and 5 tie on score and price; the earlier one wins");
    });

    it("recomputes the median, the flags and the award through the same paged path after a disqualification", async () => {
      await s.warpTo((await s.chainNow()) + 5);
      // Remove three bids above the median, so the median falls. Challenges can only be filed while the
      // award stands, so all three are filed first and then ruled on.
      for (const target of [0, 9, 7]) {
        await s.mined(await s.gavelock.write.challenge([id, BigInt(target), 0, "False compliance claim."], { account: stranger.account }));
      }
      for (let k = 0; k < 3; k++) {
        await s.mined(await s.gavelock.write.rule([id, BigInt(k), true, "Confirmed."], { account: buyer.account }));
      }
      const pending = await s.gavelock.read.getTender([id]);
      assert.equal(pending.recomputing, true);
      assert.equal(pending.generation, 3);
      assert.equal(pending.compliantCount, 7);

      let first: Awaited<ReturnType<typeof state>> | null = null;
      for (const pages of [[100], [1], [3], [2, 5, 100]]) {
        const snapshot = await s.test.snapshot();
        await finalizePaged(id, pages, [p2, stranger]);
        const result = await state(id, plan.length);
        if (first === null) first = result;
        assert.deepEqual(result, first, `pages ${JSON.stringify(pages)} changed the recomputed award`);
        await s.test.revert({ id: snapshot });
      }
      await finalizePaged(id, [2]);
      await assertMatchesCore(id, rule);
      const result = await state(id, plan.length);
      assert.deepEqual(result, first);
      // Compliant prices are now 12, 40, 65000, 100000, 100000, 101000, 104000: the median is 100000.
      assert.equal(result.median, "100000");
      assert.deepEqual(result.bids.map((b, i) => (b.abnormallyLow ? i : -1)).filter((i) => i >= 0), [2, 8, 10]);
      assert.equal(result.bids[0]!.scoredIn, 1, "a disqualified bid keeps its old score");
      assert.equal(result.bids[1]!.scoredIn, 4);
    });
  });

  // ==================================================================================== gas
  describe("what the rule costs", () => {
    for (const count of [3, 10, 50]) {
      it(`finalize over ${count} bids, rule on and off`, async () => {
        // Roughly one bid in ten is a lowball when there are enough bids for that to mean anything.
        const plan: Planned[] = Array.from({ length: count }, (_, i) => ({ price: count >= 10 && i % 10 === 3 ? BigInt(5 + i) : BigInt(100_000 + i * 700) }));
        const results: Record<string, bigint> = {};
        for (const floor of [7000, 0]) {
          const { id, rule, openGas } = await ready(plan, { rule: "lowest-price", floor, exactHints: true });
          const snapshot = await s.test.snapshot();
          const single = await finalizePaged(id, [1000]);
          await assertMatchesCore(id, rule);
          await s.test.revert({ id: snapshot });
          const paged = await finalizePaged(id, [10], [stranger, buyer]);
          await assertMatchesCore(id, rule);
          const label = floor ? "rule on" : "rule off";
          results[label] = single.totalGas;
          gasRows.push({ case: `finalize, ${count} bids, ${label}, one call`, gas: single.totalGas.toString(), okb: formatEther(single.totalGas * GAS_PRICE) });
          gasRows.push({ case: `finalize, ${count} bids, ${label}, pages of 10 (${paged.calls} calls, largest call)`, gas: paged.maxGas.toString(), okb: formatEther(paged.maxGas * GAS_PRICE) });
          gasRows.push({ case: `open ${count} bids with exact hints, ${label} (average per bid)`, gas: (openGas / BigInt(count)).toString(), okb: formatEther((openGas / BigInt(count)) * GAS_PRICE) });
          assert.ok(single.totalGas < 15_000_000n, `one-call finalize over ${count} bids used ${single.totalGas} gas`);
        }
        const extra = results["rule on"]! - results["rule off"]!;
        console.log(`        ${count} bids: rule on ${results["rule on"]} gas, rule off ${results["rule off"]} gas, difference ${extra}`);
        gasRows.push({ case: `the rule adds, at ${count} bids`, gas: extra.toString(), okb: formatEther((extra < 0n ? 0n : extra) * GAS_PRICE) });
      });
    }

    it("opening the 50th bid: with the exact hint, and with none", async () => {
      const plan: Planned[] = Array.from({ length: 50 }, (_, i) => ({ price: BigInt(100_000 + i * 700) }));
      const { id, t } = await s.createTender({ buyer, rule: "lowest-price", abnormalFloorBps: 7000 });
      await s.warpTo(Number(t.biddingStart));
      const sealed = [];
      for (const [n, b] of plan.entries()) sealed.push(await s.submitBid(id, await s.extraBidder(n), { price: b.price }));
      await s.warpTo(Number(t.deadline));
      const opened: OpenedBid[] = [];
      for (let n = 0; n < 49; n++) {
        await s.mined(await s.openBid(id, sealed[n]!, stranger, BigInt(openingHint(opened, { index: n, price: plan[n]!.price }, CHECKLIST))));
        opened.push({ index: n, price: plan[n]!.price, deliveryDays: 10, compliance: 0b00011, disqualified: false, panelMedian: null });
      }
      // The last bid is the most expensive: with no hint the contract walks the whole list to place it.
      const snapshot = await s.test.snapshot();
      const exact = await s.mined(await s.openBid(id, sealed[49]!, stranger, BigInt(openingHint(opened, { index: 49, price: plan[49]!.price }, CHECKLIST))));
      await s.test.revert({ id: snapshot });
      const none = await s.mined(await s.openBid(id, sealed[49]!, stranger, 0n));
      console.log(`        50th bid: ${exact.gasUsed} gas with the exact hint, ${none.gasUsed} gas with no hint`);
      gasRows.push({ case: "open the 50th (most expensive) bid, exact hint", gas: exact.gasUsed.toString(), okb: formatEther(exact.gasUsed * GAS_PRICE) });
      gasRows.push({ case: "open the 50th (most expensive) bid, no hint", gas: none.gasUsed.toString(), okb: formatEther(none.gasUsed * GAS_PRICE) });
      assert.ok(none.gasUsed < 1_000_000n);
    });
  });
});
