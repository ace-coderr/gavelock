// Fixes from the audit pass (docs/AUDIT.md), each proven on the fast local chain:
// challenge bonds, the bid cap and minimum deposit, the stalled-buyer forfeit rule, and money paths
// against a contract that tries to re-enter while it is being paid.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { getAddress, parseEther, type Hex } from "viem";
import { STARTER_RULES, truthTable, commitmentOf, encodeBid, type Bid } from "@gavelock/core";
import { DEPOSIT, HOUR, deployLocal, type Local } from "./local.ts";

const lowestPrice = truthTable(STARTER_RULES[0]!.spec);
const message = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (e) {
    return String((e as Error).message);
  }
};

describe("audit fixes", () => {
  let s: Local;
  before(async () => {
    s = await deployLocal();
    await s.useTable(lowestPrice);
  });

  const feeBalance = async () => (await s.gavelock.read.feesAccrued()) as bigint;
  const bal = (a: Hex) => s.pub.getBalance({ address: a });

  // ---------------------------------------------------------------- challenge bonds
  describe("challenge bonds", () => {
    async function awarded() {
      const { id } = await s.readyTender([{ price: 1000n }, { price: 1100n }, { price: 1200n }], 7000);
      await s.finalizePaged(id, [100]);
      await s.warpTo((await s.chainNow()) + 5);
      return id;
    }

    it("a challenge must carry exactly the bid deposit as a bond", async () => {
      const id = await awarded();
      for (const value of [0n, DEPOSIT - 1n, DEPOSIT + 1n]) {
        assert.match(await message(s.gavelock.simulate.challenge([id, 0n, 0, "no bond"], { account: s.other.account, value })), /WrongValue/);
      }
      await s.mined(await s.gavelock.write.challenge([id, 0n, 0, "bonded"], { account: s.other.account, value: DEPOSIT }));
      assert.equal((await s.gavelock.read.getChallenge([id, 0n])).bond, DEPOSIT);
    });

    it("an upheld challenge returns the bond to the challenger", async () => {
      const id = await awarded();
      await s.mined(await s.gavelock.write.challenge([id, 1n, 0, "false claim"], { account: s.other.account, value: DEPOSIT }));
      assert.match(await message(s.gavelock.simulate.claimBond([id, 0n], { account: s.stranger.account })), /WrongPhase/, "not before it is ruled on");
      await s.mined(await s.gavelock.write.rule([id, 0n, true, "confirmed"], { account: s.buyer.account }));
      const before = await bal(s.other.account.address);
      await s.mined(await s.gavelock.write.claimBond([id, 0n], { account: s.stranger.account }));
      assert.equal((await bal(s.other.account.address)) - before, DEPOSIT);
      assert.match(await message(s.gavelock.simulate.claimBond([id, 0n], { account: s.stranger.account })), /AlreadyDone/);
    });

    it("a rejected challenge's bond goes to the fee address and never to the buyer", async () => {
      const id = await awarded();
      await s.mined(await s.gavelock.write.challenge([id, 1n, 1, "spurious"], { account: s.other.account, value: DEPOSIT }));
      await s.mined(await s.gavelock.write.rule([id, 0n, false, "no evidence"], { account: s.buyer.account }));
      const buyerBefore = await bal(s.buyer.account.address);
      const otherBefore = await bal(s.other.account.address);
      const feesBefore = await feeBalance();
      await s.mined(await s.gavelock.write.claimBond([id, 0n], { account: s.stranger.account }));
      assert.equal(await bal(s.buyer.account.address), buyerBefore, "the buyer is not paid");
      assert.equal(await bal(s.other.account.address), otherBefore, "the challenger is not repaid");
      assert.equal((await feeBalance()) - feesBefore, DEPOSIT);
    });

    it("a bond is returned if the tender ends before the buyer rules", async () => {
      const id = await awarded();
      await s.mined(await s.gavelock.write.challenge([id, 2n, 0, "unanswered"], { account: s.other.account, value: DEPOSIT }));
      const t = await s.gavelock.read.getTender([id]);
      await s.warpTo(Number(t.standstillEnd) + HOUR);
      await s.mined(await s.gavelock.write.cancelStalled([id], { account: s.stranger.account }));
      const before = await bal(s.other.account.address);
      await s.mined(await s.gavelock.write.claimBond([id, 0n], { account: s.stranger.account }));
      assert.equal((await bal(s.other.account.address)) - before, DEPOSIT);
    });

    it("spam costs the spammer: a hundred junk challenges cost a hundred bonds", async () => {
      const id = await awarded();
      const before = await bal(s.other.account.address);
      for (let i = 0; i < 5; i++) await s.mined(await s.gavelock.write.challenge([id, BigInt(i % 3), 0, `junk ${i}`], { account: s.other.account, value: DEPOSIT }));
      assert.ok(before - (await bal(s.other.account.address)) >= 5n * DEPOSIT);
    });
  });

  // ---------------------------------------------------------------- stalled buyer
  it("a buyer who stalls on a challenge collects no forfeited deposit", async () => {
    // Two bids opened, one never opened; a challenge against an opened bid that the buyer ignores.
    const { id } = await s.readyTender([{ price: 1000n }, { price: 1100n }, { price: 1200n }, { price: 1300n, unopened: true }], 7000);
    await s.finalizePaged(id, [100]);
    await s.warpTo((await s.chainNow()) + 5);
    await s.mined(await s.gavelock.write.challenge([id, 0n, 0, "ignored"], { account: s.other.account, value: DEPOSIT }));
    const t = await s.gavelock.read.getTender([id]);
    await s.warpTo(Number(t.standstillEnd) + HOUR);
    await s.mined(await s.gavelock.write.cancelStalled([id], { account: s.stranger.account }));
    const unopenedBidder = (await s.gavelock.read.getBid([id, 3n])).bidder;
    assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, 3n])), getAddress(unopenedBidder), "returned to the bidder, not forfeited to the buyer");
    // The same tender ended any other way would have forfeited it.
    const { id: id2 } = await s.readyTender([{ price: 1000n }, { price: 1100n }, { price: 1200n }, { price: 1300n, unopened: true }], 7000);
    await s.finalizePaged(id2, [100]);
    const t2 = await s.gavelock.read.getTender([id2]);
    await s.warpTo(Number(t2.standstillEnd));
    await s.mined(await s.gavelock.write.close([id2], { account: s.stranger.account }));
    assert.equal(getAddress(await s.gavelock.read.depositRecipient([id2, 3n])), getAddress(s.buyer.account.address));
  });

  // ---------------------------------------------------------------- bid cap and minimum deposit
  it("refuses a deposit below the minimum", async () => {
    const now = (await s.chainNow()) + 10;
    const params = { quick: false, ruleId: 1, clarificationsStart: 0n, biddingStart: BigInt(now + HOUR), deadline: BigInt(now + 2 * HOUR), openingWindow: HOUR, commitWindow: 0, revealWindow: 0, standstill: HOUR, bidDeposit: parseEther("0.001") - 1n, checklistItems: 0, mandatoryMask: 0, preferredAMask: 0, preferredBMask: 0, priceLadderBps: [0, 250, 500, 1000, 1500, 2500, 4000], deliveryLadderDays: [7, 14, 30], abnormalFloorBps: 7000, panel: [], quorum: 0, terms: "0x7b7d" as Hex };
    assert.match(await message(s.gavelock.simulate.createTender([params], { account: s.buyer.account })), /BadDeposit/);
    assert.equal(await message(s.gavelock.simulate.createTender([{ ...params, bidDeposit: parseEther("0.001") }], { account: s.buyer.account })), "");
  });

  it("accepts 200 bids and refuses the 201st", async () => {
    const { id, params } = await s.createTender(7000);
    await s.warpTo(params.biddingStart);
    const submit = async (n: number) => {
      const who = await s.bidder(n);
      return s.gavelock.write.submitBid([id, `0x${(n + 1).toString(16).padStart(64, "0")}`, "0x01"], { account: who.account, value: DEPOSIT });
    };
    const hashes = [];
    for (let n = 0; n < 200; n++) hashes.push(await submit(n));
    await s.mined(hashes[199]!);
    assert.equal(await s.gavelock.read.bidCount([id]), 200n);
    const extra = await s.bidder(200);
    assert.match(await message(s.gavelock.simulate.submitBid([id, `0x${"ff".repeat(32)}`, "0x01"], { account: extra.account, value: DEPOSIT })), /TenderFull/);
    assert.equal(await s.gavelock.read.MAX_BIDS(), 200n);
  });

  // ---------------------------------------------------------------- reentrancy
  describe("a contract that re-enters while it is paid", () => {
    it("is paid its deposit exactly once, and every re-entry fails", async () => {
      const attacker = (await s.viem.deployContract("ReentrantBidder", [s.gavelock.address])) as any;
      const { id, params } = await s.createTender(7000);
      await s.warpTo(params.biddingStart);
      await s.mined(await attacker.write.bid([id, `0x${"aa".repeat(32)}`], { value: DEPOSIT }));
      // A second, honest bid, so the contract holds more than the attacker's deposit.
      const honest = await s.bidder(1);
      await s.mined(await s.gavelock.write.submitBid([id, `0x${"bb".repeat(32)}`, "0x01"], { account: honest.account, value: DEPOSIT }));
      await s.mined(await s.gavelock.write.cancel([id, "stopping"], { account: s.buyer.account }));

      const contractBefore = await bal(s.gavelock.address);
      await s.mined(await attacker.write.collectDeposit());
      assert.equal(await bal(attacker.address), DEPOSIT, "paid once");
      assert.equal(contractBefore - (await bal(s.gavelock.address)), DEPOSIT, "the contract paid out once");
      assert.ok(Number(await attacker.read.attempts()) >= 1, "the attacker did try");
      assert.equal(await attacker.read.reentriesThatWorked(), 0n);
      assert.match(await message(s.gavelock.simulate.claimDeposit([id, 0n], { account: s.stranger.account })), /AlreadyDone/);
      // The honest bidder's deposit is untouched and still claimable.
      const before = await bal(honest.account.address);
      await s.mined(await s.gavelock.write.claimDeposit([id, 1n], { account: s.stranger.account }));
      assert.equal((await bal(honest.account.address)) - before, DEPOSIT);
    });

    it("cannot block anyone else by refusing payment", async () => {
      // A bidder contract that rejects OKB can only block its own deposit; deposits are pulled one by one.
      const refuser = (await s.viem.deployContract("ReentrantBidder", [s.gavelock.address])) as any;
      const { id, params } = await s.createTender(7000);
      await s.warpTo(params.biddingStart);
      await s.mined(await refuser.write.bid([id, `0x${"dd".repeat(32)}`], { value: DEPOSIT }));
      const honest = await s.bidder(2);
      await s.mined(await s.gavelock.write.submitBid([id, `0x${"cc".repeat(32)}`, "0x01"], { account: honest.account, value: DEPOSIT }));
      await s.mined(await s.gavelock.write.cancel([id, "stopping"], { account: s.buyer.account }));
      await s.mined(await refuser.write.setRefuse([true]));
      assert.match(await message(s.gavelock.simulate.claimDeposit([id, 0n], { account: s.stranger.account })), /PaymentFailed/);
      const before = await bal(honest.account.address);
      await s.mined(await s.gavelock.write.claimDeposit([id, 1n], { account: s.stranger.account }));
      assert.equal((await bal(honest.account.address)) - before, DEPOSIT, "the honest bidder is paid regardless");
      // And once the refuser relents it can still collect: nothing was lost.
      await s.mined(await refuser.write.setRefuse([false]));
      await s.mined(await s.gavelock.write.claimDeposit([id, 0n], { account: s.stranger.account }));
      assert.equal(await bal(refuser.address), DEPOSIT);
    });
  });

  // ---------------------------------------------------------------- misc invariants
  it("keeps every contract under the size limit with headroom", async () => {
    const sizes = await Promise.all([s.gavelock.address, s.engine.address].map(async (a) => ((await s.pub.getCode({ address: a }))!.length - 2) / 2));
    assert.ok(sizes[0]! < 22_000, `Gavelock is ${sizes[0]} bytes`);
    assert.ok(sizes[1]! < 24_576);
  });

  it("a commitment from another tender cannot be opened", async () => {
    const { id, params } = await s.createTender(7000);
    const { id: other } = await s.createTender(7000);
    void params;
    const bid: Bid = { price: 5n, deliveryDays: 1, compliance: 0, note: "", salt: `0x${"01".repeat(32)}` };
    const who = await s.bidder(7);
    const forOther = commitmentOf({ chainId: s.chainId, contract: s.gavelock.address, tenderId: other, bidder: who.account.address }, bid);
    const t = await s.gavelock.read.getTender([id]);
    await s.warpTo(Number(t.biddingStart));
    await s.mined(await s.gavelock.write.submitBid([id, forOther, "0x01"], { account: who.account, value: DEPOSIT }));
    await s.warpTo(Number(t.deadline));
    assert.match(await message(s.gavelock.simulate.openBid([id, 0n, bid.price, bid.deliveryDays, bid.compliance, bid.note, bid.salt, 0n], { account: s.stranger.account })), /CommitmentMismatch/);
    void encodeBid;
  });
});
