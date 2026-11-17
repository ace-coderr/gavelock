// The tender lifecycle against the real TapeOut contracts on a fork of X Layer mainnet.
// Every award the contract computes is compared with the reference computation in packages/core.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { bytesToHex, formatEther, getAddress, hexToBytes, parseEther, zeroAddress, type Hex } from "viem";
import { roundAtOrAfter } from "@gavelock/core";
import { sealHeader } from "@gavelock/core/seal";
import { revertOf } from "./helpers.ts";
import { DEPOSIT, GAS_PRICE, HOUR, TENDER_FEE, deploySystem, type System } from "./system.ts";

const sha256 = (bytes: Uint8Array) => `0x${createHash("sha256").update(bytes).digest("hex")}` as Hex;
const filler = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 131 + seed) & 255);
const text = async (s: System, contract: any, pointer: string) => Buffer.from(((await contract.read.read([pointer])) as Hex).slice(2), "hex").toString("utf8");
const salt = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

describe("Gavelock on a fork of X Layer", () => {
  let s: System;
  let buyer: any, p1: any, p2: any, p3: any, stranger: any;
  let bidders: any[];

  before(async () => {
    s = await deploySystem();
    const w = s.wallets as any[];
    [buyer, p1, p2, p3] = [w[2], w[3], w[4], w[5]];
    bidders = w.slice(6, 18);
    stranger = w[18];
  });

  after(() => {
    // Gas per kind of transaction, for the Gate B cost table.
    const byStep = new Map<string, { count: number; total: bigint; max: bigint }>();
    for (const g of s.gas) {
      const e = byStep.get(g.step) ?? { count: 0, total: 0n, max: 0n };
      e.count++;
      e.total += g.gas;
      if (g.gas > e.max) e.max = g.gas;
      byStep.set(g.step, e);
    }
    const rows = [...byStep].map(([step, e]) => ({ step, count: e.count, averageGas: Number(e.total / BigInt(e.count)), maxGas: Number(e.max), maxOKB: formatEther(e.max * GAS_PRICE) }));
    console.table(rows);
    fs.mkdirSync(new URL("../../reports/", import.meta.url), { recursive: true });
    fs.writeFileSync(new URL("../../reports/gas.json", import.meta.url), JSON.stringify({ gasPriceWei: GAS_PRICE.toString(), rows }, null, 2) + "\n");
  });

  it("deploys with its panel and records contracts linked and no admin", async () => {
    assert.equal(getAddress(await s.panel.read.tenders()), getAddress(s.gavelock.address));
    assert.equal(getAddress(await s.records.read.tenders()), getAddress(s.gavelock.address));
    assert.equal(getAddress(await s.gavelock.read.ruleStock()), getAddress(s.stock.address));
    assert.equal(getAddress(await s.gavelock.read.circuits()), getAddress(await s.stock.read.circuits()));
    assert.equal(await s.gavelock.read.tenderFee(), TENDER_FEE);
    for (const contract of [s.gavelock, s.panel, s.records, s.stock]) {
      const names = (contract.abi as any[]).filter((f) => f.type === "function").map((f) => f.name as string);
      for (const forbidden of ["owner", "transferOwnership", "upgradeTo", "upgradeToAndCall", "pause", "setFee", "setFeeRecipient"]) {
        assert.ok(!names.includes(forbidden), `${forbidden} must not exist`);
      }
    }
    const code = await s.pub.getCode({ address: s.gavelock.address });
    assert.ok((code!.length - 2) / 2 <= 24_576);
  });

  it("rejects malformed tenders", async () => {
    const now = await s.chainNow();
    const base = {
      quick: false,
      ruleId: s.rules["lowest-price"].id,
      clarificationsStart: 0n,
      biddingStart: BigInt(now + HOUR),
      deadline: BigInt(now + 2 * HOUR),
      openingWindow: HOUR,
      commitWindow: 0,
      revealWindow: 0,
      standstill: HOUR,
      bidDeposit: DEPOSIT,
      checklistItems: 5,
      mandatoryMask: 3,
      preferredAMask: 4,
      preferredBMask: 24,
      priceLadderBps: [0, 250, 500, 1000, 1500, 2500, 4000],
      deliveryLadderDays: [7, 14, 30],
      abnormalFloorBps: 7000,
      panel: [] as string[],
      quorum: 0,
      terms: "0x7b7d" as Hex,
    };
    const attempt = (over: object, value = TENDER_FEE) => revertOf(s.gavelock.simulate.createTender([{ ...base, ...over }], { account: buyer.account, value }));
    assert.equal(await attempt({}), "", "the base parameters are valid");
    assert.match(await attempt({}, 0n), /WrongValue/);
    assert.match(await attempt({ quick: true }, TENDER_FEE), /WrongValue/);
    assert.match(await attempt({ quick: true, panel: [p1.account.address], quorum: 1, commitWindow: HOUR, revealWindow: HOUR }, 0n), /BadPanel/);
    assert.match(await attempt({ deadline: base.biddingStart }), /BadTimes/);
    assert.match(await attempt({ deadline: base.biddingStart + 59n }), /BadTimes/);
    assert.match(await attempt({ openingWindow: 59 }), /BadTimes/);
    assert.match(await attempt({ standstill: 0 }), /BadTimes/);
    assert.match(await attempt({ biddingStart: BigInt(now - 10) }), /BadTimes/);
    assert.match(await attempt({ clarificationsStart: base.biddingStart + 1n }), /BadTimes/);
    assert.match(await attempt({ standstill: 366 * 24 * HOUR }), /BadTimes/);
    assert.match(await attempt({ panel: [p1.account.address, p2.account.address], quorum: 3, commitWindow: HOUR, revealWindow: HOUR }), /BadPanel/);
    assert.match(await attempt({ panel: [p1.account.address, p1.account.address], quorum: 1, commitWindow: HOUR, revealWindow: HOUR }), /BadPanel/);
    assert.match(await attempt({ panel: [buyer.account.address], quorum: 1, commitWindow: HOUR, revealWindow: HOUR }), /BadPanel/);
    assert.match(await attempt({ panel: [p1.account.address], quorum: 1, commitWindow: 0, revealWindow: HOUR }), /BadTimes/);
    assert.match(await attempt({ commitWindow: HOUR }), /BadPanel/);
    assert.match(await attempt({ ruleId: 999 }), /BadRule/);
    assert.match(await attempt({ mandatoryMask: 3, preferredAMask: 1 }), /BadChecklist/);
    assert.match(await attempt({ checklistItems: 2 }), /BadChecklist/);
    assert.match(await attempt({ checklistItems: 33 }), /BadChecklist/);
    assert.match(await attempt({ priceLadderBps: [0, 250, 250, 1000, 1500, 2500, 4000] }), /BadLadder/);
    assert.match(await attempt({ deliveryLadderDays: [7, 14, 4000] }), /BadLadder/);
    assert.match(await attempt({ abnormalFloorBps: 10_001 }), /BadLadder/);
    assert.equal(await attempt({ abnormalFloorBps: 0 }), "");
    assert.equal(await attempt({ abnormalFloorBps: 10_000 }), "");
    assert.match(await attempt({ terms: "0x" }), /BadLength/);
  });

  // ==================================================================================== full lifecycle
  describe("a full tender from publication to final", () => {
    let id: bigint;
    let t: any;
    let rule: System["rules"][keyof System["rules"]];
    const sealed: any[] = [];
    const document = filler(60_000);

    it("is created with its parameters stored and the drand round fixed", async () => {
      const feesBefore = await s.gavelock.read.feesAccrued();
      const created = await s.createTender({ buyer, panel: [p1, p2, p3], quorum: 2, rule: "price-60-quality-40" });
      ({ id, t, rule } = created);
      assert.equal(getAddress(t.buyer), getAddress(buyer.account.address));
      assert.equal(t.quick, false);
      assert.equal(t.ruleId, rule.id);
      assert.equal(t.panelSize, 3);
      assert.equal(t.quorum, 2);
      assert.equal(Number(t.drandRound), roundAtOrAfter(Number(t.deadline)));
      assert.equal(t.openingEnd, t.deadline + BigInt(HOUR));
      assert.equal(t.revealEnd, t.deadline + BigInt(3 * HOUR));
      assert.equal(t.createdBlock, created.receipt.blockNumber);
      assert.deepEqual(t.priceLadderBps, [0, 250, 500, 1000, 1500, 2500, 4000]);
      assert.deepEqual(t.deliveryLadderDays, [7, 14, 30]);
      assert.equal((await s.gavelock.read.feesAccrued()) - feesBefore, TENDER_FEE);
      assert.equal(JSON.parse(await text(s, s.gavelock, t.terms)).title, "Fork test tender");
      assert.deepEqual((await s.panel.read.panelOf([id])).map((a: string) => getAddress(a)), [p1, p2, p3].map((w) => getAddress(w.account.address)));
      assert.equal(await s.gavelock.read.tendersOf([buyer.account.address]), 1n);
      assert.equal(await s.gavelock.read.tenderOfBuyer([buyer.account.address, 0n]), id);
      assert.equal(await s.phase(id), "Clarifications");
    });

    it("stores documents as contract code with the SHA-256 checked on chain", async () => {
      const small = new TextEncoder().encode("Specification v1: 40 solar lanterns, delivered to Gulu.");
      await s.track("publish a small document", await s.records.write.publishDocument([id, "spec.txt", "text/plain", sha256(small), small.length, bytesToHex(small)], { account: buyer.account }));
      // A larger file, in three chunks.
      await s.track("document chunk (20,000 bytes)", await s.records.write.publishDocument([id, "drawings.pdf", "application/pdf", sha256(document), document.length, bytesToHex(document.subarray(0, 20_000))], { account: buyer.account }));
      assert.equal((await s.records.read.getDocument([id, 1n])).completedBlock, 0n);
      await s.track("document chunk (20,000 bytes)", await s.records.write.appendDocument([id, 1n, bytesToHex(document.subarray(20_000, 40_000))], { account: buyer.account }));
      const last = await s.track("document chunk (20,000 bytes)", await s.records.write.appendDocument([id, 1n, bytesToHex(document.subarray(40_000))], { account: buyer.account }));

      const doc = await s.records.read.getDocument([id, 1n]);
      assert.equal(doc.sha256Hash, sha256(document));
      assert.equal(doc.size, 60_000);
      assert.equal(doc.received, 60_000);
      assert.equal(doc.completedBlock, last.blockNumber);
      assert.equal(doc.name, "drawings.pdf");
      assert.equal(doc.chunks.length, 3);
      const stored = Buffer.concat(await Promise.all(doc.chunks.map(async (c: string) => Buffer.from(hexToBytes(await s.records.read.read([c]))))));
      assert.ok(stored.equals(Buffer.from(document)), "the stored bytes are the document");
      assert.equal(await s.records.read.documentCount([id]), 2n);

      const publish = (args: unknown[], account: any = buyer.account) => revertOf(s.records.simulate.publishDocument(args, { account }));
      assert.match(await publish([id, "x", "", sha256(small), small.length, bytesToHex(small)], stranger.account), /NotBuyer/);
      assert.match(await publish([id, "x", "", sha256(document), small.length, bytesToHex(small)]), /HashMismatch/);
      assert.match(await publish([id, "", "", sha256(small), small.length, bytesToHex(small)]), /BadLength/);
      assert.match(await publish([id, "x", "", sha256(small), small.length - 1, bytesToHex(small)]), /BadLength/);
      assert.match(await publish([id, "x", "", sha256(small), 2 ** 20 + 1, bytesToHex(small)]), /BadLength/);
      assert.match(await revertOf(s.records.simulate.appendDocument([id, 1n, "0x00"], { account: buyer.account })), /AlreadyDone/);
      assert.match(await revertOf(s.records.simulate.appendDocument([id, 9n, "0x00"], { account: buyer.account })), /NoSuchRecord/);
    });

    it("takes questions from anyone and one answer each from the buyer", async () => {
      await s.track("ask a question", await s.records.write.ask([id, "Is partial delivery allowed?"], { account: stranger.account }));
      await s.track("ask a question", await s.records.write.ask([id, "Which Incoterm applies?"], { account: bidders[0].account }));
      const answered = await s.track("answer a question", await s.records.write.answer([id, 0n, "Yes, in at most two lots."], { account: buyer.account }));
      const q = await s.records.read.getQuestion([id, 0n]);
      assert.equal(getAddress(q.asker), getAddress(stranger.account.address));
      assert.equal(await text(s, s.records, q.text), "Is partial delivery allowed?");
      assert.equal(await text(s, s.records, q.answer), "Yes, in at most two lots.");
      assert.equal(q.answeredBlock, answered.blockNumber);
      assert.equal((await s.records.read.getQuestion([id, 1n])).answeredBlock, 0n);
      assert.match(await revertOf(s.records.simulate.answer([id, 0n, "again"], { account: buyer.account })), /AlreadyDone/);
      assert.match(await revertOf(s.records.simulate.answer([id, 1n, "not mine"], { account: stranger.account })), /NotBuyer/);
      assert.match(await revertOf(s.records.simulate.ask([id, ""], { account: stranger.account })), /BadLength/);
      assert.match(await revertOf(s.records.simulate.ask([id, "x".repeat(2049)], { account: stranger.account })), /BadLength/);
    });

    it("refuses bids before bidding starts", async () => {
      assert.match(await revertOf(s.gavelock.simulate.submitBid([id, salt(1), "0x01"], { account: bidders[0].account, value: DEPOSIT })), /WrongPhase/);
    });

    it("freezes documents and clarifications the moment bidding starts", async () => {
      await s.warpTo(Number(t.biddingStart));
      assert.equal(await s.phase(id), "Bidding");
      const small = new TextEncoder().encode("late addendum");
      assert.match(await revertOf(s.records.simulate.publishDocument([id, "late.txt", "", sha256(small), small.length, bytesToHex(small)], { account: buyer.account })), /Frozen/);
      assert.match(await revertOf(s.records.simulate.ask([id, "late question"], { account: stranger.account })), /Frozen/);
      assert.match(await revertOf(s.records.simulate.answer([id, 1n, "late answer"], { account: buyer.account })), /Frozen/);
    });

    it("accepts one sealed bid per bidder, with the exact deposit, from outsiders only", async () => {
      sealed.push(await s.submitBid(id, bidders[0], { price: 100_000n, deliveryDays: 10, compliance: 0b00111, note: "Warranty 24 months." }));
      sealed.push(await s.submitBid(id, bidders[1], { price: 110_000n, deliveryDays: 5, compliance: 0b11011 }));
      sealed.push(await s.submitBid(id, bidders[2], { price: 130_000n, deliveryDays: 20, compliance: 0b00011 }));
      sealed.push(await s.submitBid(id, bidders[3], { price: 90_000n, deliveryDays: 3, compliance: 0b11111 })); // will never be opened

      const b = await s.gavelock.read.getBid([id, 0n]);
      assert.equal(getAddress(b.bidder), getAddress(bidders[0].account.address));
      assert.equal(b.commitment, sealed[0].commitment);
      assert.equal(b.opened, false);
      assert.equal(b.price, 0n, "nothing about the bid is readable before it is opened");
      // The ciphertext on chain is the one that was sealed, and it names the tender's drand round.
      const onChain = await s.gavelock.read.read([b.ciphertext]);
      assert.equal(onChain, sealed[0].ciphertext);
      assert.deepEqual(sealHeader(hexToBytes(onChain)), { round: Number(t.drandRound), chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971" });
      assert.equal(await s.gavelock.read.bidOf([id, bidders[0].account.address]), 1n);
      assert.deepEqual(await s.gavelock.read.bidOfBidder([bidders[0].account.address, 0n]), [id, 0n]);
      assert.equal(await s.pub.getBalance({ address: s.gavelock.address }), (await s.gavelock.read.feesAccrued()) + 4n * DEPOSIT);

      const submit = (account: any, value: bigint, ciphertext: Hex = "0x01") => revertOf(s.gavelock.simulate.submitBid([id, salt(2), ciphertext], { account, value }));
      assert.match(await submit(bidders[4].account, DEPOSIT - 1n), /WrongValue/);
      assert.match(await submit(bidders[4].account, 0n), /WrongValue/);
      assert.match(await submit(buyer.account, DEPOSIT), /ConflictOfInterest/);
      assert.match(await submit(p2.account, DEPOSIT), /ConflictOfInterest/);
      assert.match(await submit(bidders[0].account, DEPOSIT), /AlreadyBid/);
      assert.match(await submit(bidders[4].account, DEPOSIT, "0x"), /BadLength/);
      assert.match(await submit(bidders[4].account, DEPOSIT, `0x${"00".repeat(2049)}`), /BadLength/);
      // Nobody can open during bidding, not even with the right values.
      assert.match(await revertOf(s.gavelock.simulate.openBid([id, 0n, 100_000n, 10, 0b00111, "Warranty 24 months.", sealed[0].bid.salt, 0n], { account: bidders[0].account })), /WrongPhase/);
    });

    it("refuses a bid at the deadline", async () => {
      await s.warpTo(Number(t.deadline));
      assert.equal(await s.phase(id), "Opening");
      assert.match(await revertOf(s.gavelock.simulate.submitBid([id, salt(3), "0x01"], { account: bidders[5].account, value: DEPOSIT })), /WrongPhase/);
    });

    it("lets anyone open a bid, but only with exactly the committed values", async () => {
      const a = sealed[0];
      const open = (over: Partial<{ price: bigint; days: number; compliance: number; note: string; salt: Hex; index: bigint }>) =>
        revertOf(
          s.gavelock.simulate.openBid([id, over.index ?? a.index, over.price ?? a.bid.price, over.days ?? a.bid.deliveryDays, over.compliance ?? a.bid.compliance, over.note ?? a.bid.note, over.salt ?? a.bid.salt, 0n], {
            account: stranger.account,
          }),
        );
      assert.match(await open({ price: a.bid.price - 1n }), /CommitmentMismatch/);
      assert.match(await open({ days: 9 }), /CommitmentMismatch/);
      assert.match(await open({ compliance: 0b11111 }), /CommitmentMismatch/);
      assert.match(await open({ note: "Warranty 36 months." }), /CommitmentMismatch/);
      assert.match(await open({ salt: salt(9) }), /CommitmentMismatch/);
      assert.match(await open({ index: 1n }), /CommitmentMismatch/); // another bidder's slot
      assert.match(await open({ price: 0n }), /BadBid/);
      assert.match(await open({ index: 99n }), /NoSuchRecord/);

      // A stranger opens three of the four bids.
      for (const one of sealed.slice(0, 3)) await s.track("open a bid", await s.openBid(id, one, stranger));
      const b = await s.gavelock.read.getBid([id, 0n]);
      assert.equal(b.opened, true);
      assert.equal(b.price, 100_000n);
      assert.equal(b.deliveryDays, 10);
      assert.equal(b.compliance, 0b00111);
      assert.equal(b.salt, a.bid.salt);
      assert.equal(await text(s, s.gavelock, b.note), "Warranty 24 months.");
      assert.equal((await s.gavelock.read.getBid([id, 1n])).note, zeroAddress, "an empty note stores nothing");
      assert.equal((await s.gavelock.read.getTender([id])).openedCount, 3);
      assert.match(await open({}), /AlreadyDone/);
    });

    it("closes the opening window and takes hidden panel scores", async () => {
      await s.warpTo(Number(t.openingEnd));
      assert.equal(await s.phase(id), "Evaluation");
      assert.match(await revertOf(s.openBid(id, sealed[3], stranger)), /WrongPhase/);
      assert.match(await revertOf(s.gavelock.simulate.finalize([id, 100n], { account: stranger.account })), /WrongPhase/);

      const scores = { p1: [60, 95, 40, 0], p2: [70, 85, 50, 0], p3: [101, 0, 0, 0] };
      await s.track("panel member commits scores", await s.panel.write.commitScores([id, s.scoreCommitment(id, p1.account.address, scores.p1, salt(11))], { account: p1.account }));
      await s.track("panel member commits scores", await s.panel.write.commitScores([id, s.scoreCommitment(id, p2.account.address, scores.p2, salt(12))], { account: p2.account }));
      await s.track("panel member commits scores", await s.panel.write.commitScores([id, s.scoreCommitment(id, p3.account.address, scores.p3, salt(13))], { account: p3.account }));
      assert.match(await revertOf(s.panel.simulate.commitScores([id, salt(1)], { account: stranger.account })), /NotPanelMember/);
      assert.match(await revertOf(s.panel.simulate.commitScores([id, salt(1)], { account: p1.account })), /AlreadyDone/);
      const reveal = (who: any, values: number[], sl: Hex) => revertOf(s.panel.simulate.revealScores([id, bytesToHex(Uint8Array.from(values)), sl], { account: who.account }));
      assert.match(await reveal(p1, scores.p1, salt(11)), /WrongPhase/); // still the commit window
      // A committed member's scores are not readable before the reveal.
      assert.equal((await s.panel.read.memberOf([id, p1.account.address])).scores, "0x");

      await s.warpTo(Number(t.commitEnd));
      assert.match(await revertOf(s.panel.simulate.commitScores([id, salt(1)], { account: p1.account })), /WrongPhase/);
      assert.match(await reveal(p1, [61, 95, 40, 0], salt(11)), /CommitmentMismatch/);
      assert.match(await reveal(p1, scores.p1, salt(99)), /CommitmentMismatch/);
      assert.match(await reveal(p1, scores.p1.slice(0, 3), salt(11)), /BadScores/);
      assert.match(await reveal(p3, scores.p3, salt(13)), /BadScores/); // committed to a score above 100: cannot be revealed
      assert.match(await reveal(stranger, scores.p1, salt(11)), /NotPanelMember/);
      await s.track("panel member reveals scores", await s.panel.write.revealScores([id, bytesToHex(Uint8Array.from(scores.p1)), salt(11)], { account: p1.account }));
      await s.track("panel member reveals scores", await s.panel.write.revealScores([id, bytesToHex(Uint8Array.from(scores.p2)), salt(12)], { account: p2.account }));
      assert.match(await reveal(p1, scores.p1, salt(11)), /AlreadyDone/);
      assert.equal(await s.panel.read.revealedCount([id]), 2n);
      assert.equal(await s.panel.read.medianOf([id, 0n]), 65n);
    });

    it("computes the award exactly as the reference does, for whoever asks", async () => {
      await s.warpTo(Number(t.revealEnd));
      const receipt = await s.track("finalize: award over 4 bids, one call", await s.gavelock.write.finalize([id, 100n], { account: stranger.account }));
      const { award, chain, t: after } = await s.referenceAward(id, rule.table);

      assert.equal(award.winner, 0);
      assert.equal(after.best - 1, award.winner);
      assert.equal(after.lowestValidPrice, award.lowestValidPrice);
      assert.equal(after.awardedBlock, receipt.blockNumber);
      assert.equal(after.standstillEnd, after.awardedAt + BigInt(HOUR));
      for (const scored of award.scored) {
        const b = chain[scored.index];
        assert.equal(b.ruleInput, scored.input, `bid ${scored.index}: rule input`);
        assert.equal(b.score, scored.outcome.score, `bid ${scored.index}: score`);
        assert.equal(b.eligible, scored.outcome.eligible, `bid ${scored.index}: eligible`);
        assert.equal(b.scoredIn, 1);
      }
      assert.deepEqual(chain.slice(0, 3).map((b: any) => b.score), [13, 11, 4]);
      assert.deepEqual(chain.slice(0, 3).map((b: any) => b.panelMedian), [65, 90, 45]);
      assert.equal(chain[3].scoredIn, 0, "the unopened bid was never scored");
      assert.equal(await s.phase(id), "Awarded"); // the award block itself
      assert.match(await revertOf(s.gavelock.simulate.finalize([id, 100n], { account: stranger.account })), /WrongPhase/);
    });

    it("hears a challenge, records the buyer's reasoned ruling, and closes only after the standstill", async () => {
      await s.warpTo((await s.chainNow()) + 5);
      assert.equal(await s.phase(id), "Standstill");
      await s.track("file a challenge", await s.gavelock.write.challenge([id, 0n, 0, "Item 2 (ISO 9001) is claimed but the certificate expired."], { account: bidders[1].account, value: DEPOSIT }));
      assert.equal((await s.gavelock.read.getTender([id])).openChallenges, 1);
      assert.match(await revertOf(s.gavelock.simulate.challenge([id, 3n, 0, "x"], { account: stranger.account, value: DEPOSIT })), /BadBid/); // never opened
      assert.match(await revertOf(s.gavelock.simulate.challenge([id, 0n, 2, "x"], { account: stranger.account, value: DEPOSIT })), /NoSuchRecord/);
      assert.match(await revertOf(s.gavelock.simulate.challenge([id, 0n, 0, ""], { account: stranger.account, value: DEPOSIT })), /BadLength/);
      assert.match(await revertOf(s.gavelock.simulate.rule([id, 0n, false, "no"], { account: stranger.account })), /NotBuyer/);
      assert.match(await revertOf(s.gavelock.simulate.rule([id, 0n, false, ""], { account: buyer.account })), /BadLength/);

      const ruled = await s.track("rule on a challenge", await s.gavelock.write.rule([id, 0n, false, "Certificate renewed on 3 November; copy in document 2."], { account: buyer.account }));
      const c = await s.gavelock.read.getChallenge([id, 0n]);
      assert.equal(c.ruling, 2);
      assert.equal(c.ruledBlock, ruled.blockNumber);
      assert.equal(await text(s, s.gavelock, c.rulingReason), "Certificate renewed on 3 November; copy in document 2.");
      assert.match(await revertOf(s.gavelock.simulate.rule([id, 0n, true, "changed my mind"], { account: buyer.account })), /AlreadyDone/);
      const still = await s.gavelock.read.getTender([id]);
      assert.equal(still.openChallenges, 0);
      assert.equal(still.best - 1, 0, "a rejected challenge leaves the award alone");

      assert.match(await revertOf(s.gavelock.simulate.close([id], { account: stranger.account })), /WrongPhase/);
      await s.warpTo(Number(still.standstillEnd));
      assert.match(await revertOf(s.gavelock.simulate.challenge([id, 1n, 1, "too late"], { account: stranger.account, value: DEPOSIT })), /WrongPhase/);
      await s.track("close the tender", await s.gavelock.write.close([id], { account: stranger.account }));
      assert.equal(await s.phase(id), "Final");
      assert.match(await revertOf(s.gavelock.simulate.cancel([id, "regret"], { account: buyer.account })), /WrongPhase/);
      assert.match(await revertOf(s.gavelock.simulate.rule([id, 0n, true, "late"], { account: buyer.account })), /WrongPhase/);
    });

    it("returns deposits by pull, and gives the unopened bid's deposit to the buyer", async () => {
      for (const [index, expected] of [[0, bidders[0]], [1, bidders[1]], [2, bidders[2]], [3, buyer]] as const) {
        assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, BigInt(index)])), getAddress(expected.account.address));
        const before = await s.pub.getBalance({ address: expected.account.address });
        await s.track("claim a deposit", await s.gavelock.write.claimDeposit([id, BigInt(index)], { account: stranger.account }));
        assert.equal((await s.pub.getBalance({ address: expected.account.address })) - before, DEPOSIT);
        assert.match(await revertOf(s.gavelock.simulate.claimDeposit([id, BigInt(index)], { account: stranger.account })), /AlreadyDone/);
      }
      // The one challenge in this tender was ruled on; its bond is paid out the same way.
      const bondBefore = await s.pub.getBalance({ address: bidders[1].account.address });
      await s.track("claim a challenge bond", await s.gavelock.write.claimBond([id, 0n], { account: stranger.account }));
      assert.equal((await s.pub.getBalance({ address: bidders[1].account.address })) - bondBefore, 0n, "a rejected challenge's bond is not returned");
      assert.equal(await s.pub.getBalance({ address: s.gavelock.address }), await s.gavelock.read.feesAccrued(), "only fees remain in the contract");
    });

    it("pays the tender fee to the fee address", async () => {
      const accrued = await s.gavelock.read.feesAccrued();
      const before = await s.pub.getBalance({ address: s.feeRecipient.account.address });
      await s.track("withdraw fees", await s.gavelock.write.withdrawFees({ account: stranger.account }));
      assert.equal((await s.pub.getBalance({ address: s.feeRecipient.account.address })) - before, accrued);
      assert.equal(await s.pub.getBalance({ address: s.gavelock.address }), 0n);
      assert.match(await revertOf(s.gavelock.simulate.withdrawFees({ account: stranger.account })), /NothingToDo/);
    });
  });

  // ==================================================================================== paged finalize
  describe("paged finalize (Gate A condition 3)", () => {
    let id: bigint;
    let t: any;
    let rule: System["rules"][keyof System["rules"]];
    const sealed: any[] = [];

    // Ten bids. Bids 1 and 5 are identical in every scored respect (a full tie at the top); bid 6 is a
    // non-compliant lowball that must not move anyone's price band; bid 4 is never opened.
    const plan = [
      { price: 120_000n, days: 12, compliance: 0b00011 },
      { price: 100_000n, days: 6, compliance: 0b00111 },
      { price: 100_000n, days: 6, compliance: 0b00011 },
      { price: 101_000n, days: 6, compliance: 0b00111 },
      { price: 150_000n, days: 40, compliance: 0b00011 },
      { price: 100_000n, days: 6, compliance: 0b00111 },
      { price: 60_000n, days: 2, compliance: 0b00001 },
      { price: 110_000n, days: 30, compliance: 0b11011 },
      { price: 125_000n, days: 8, compliance: 0b11111 },
      { price: 100_000n, days: 15, compliance: 0b00011 },
    ];
    const panelScores = [
      [50, 100, 70, 100, 0, 100, 100, 60, 90, 30],
      [55, 100, 75, 99, 0, 100, 100, 65, 95, 35],
      [45, 100, 65, 98, 0, 100, 100, 55, 85, 25],
    ];

    const snapshotAward = async () => {
      const tender = await s.gavelock.read.getTender([id]);
      const bids = [];
      for (let i = 0; i < plan.length; i++) {
        const b = await s.gavelock.read.getBid([id, BigInt(i)]);
        bids.push({ score: b.score, eligible: b.eligible, ruleInput: b.ruleInput, panelMedian: b.panelMedian, scoredIn: b.scoredIn, disqualified: b.disqualified, abnormallyLow: b.abnormallyLow });
      }
      return { winner: tender.best - 1, bestScore: tender.bestScore, lowest: tender.lowestValidPrice.toString(), median: tender.medianPrice.toString(), generation: tender.generation, bids };
    };

    /** Run finalize with the given page sizes (the last one repeats), rotating through callers. */
    const runPaged = async (pages: number[], callers: any[]) => {
      let calls = 0;
      let maxGas = 0n;
      for (;;) {
        const page = pages[Math.min(calls, pages.length - 1)]!;
        const receipt = await s.mined(await s.gavelock.write.finalize([id, BigInt(page)], { account: callers[calls % callers.length].account }));
        if (receipt.gasUsed > maxGas) maxGas = receipt.gasUsed;
        calls++;
        if ((await s.gavelock.read.getTender([id])).awardedAt !== 0n) return { calls, maxGas };
        assert.ok(calls < 100, "finalize does not terminate");
      }
    };

    before(async () => {
      ({ id, t, rule } = await s.createTender({ buyer, panel: [p1, p2, p3], quorum: 2, rule: "price-60-quality-40" }));
      await s.warpTo(Number(t.biddingStart));
      for (const [i, b] of plan.entries()) sealed.push(await s.submitBid(id, bidders[i], { price: b.price, deliveryDays: b.days, compliance: b.compliance }));
      await s.warpTo(Number(t.deadline));
      for (const [i, one] of sealed.entries()) if (i !== 4) await s.mined(await s.openBid(id, one, stranger));
      await s.warpTo(Number(t.openingEnd));
      for (const [k, member] of [p1, p2, p3].entries()) {
        await s.mined(await s.panel.write.commitScores([id, s.scoreCommitment(id, member.account.address, panelScores[k]!, salt(20 + k))], { account: member.account }));
      }
      await s.warpTo(Number(t.commitEnd));
      for (const [k, member] of [p1, p2, p3].entries()) {
        await s.mined(await s.panel.write.revealScores([id, bytesToHex(Uint8Array.from(panelScores[k]!)), salt(20 + k)], { account: member.account }));
      }
      await s.warpTo(Number(t.revealEnd));
    });

    it("gives the same award for every page size and every caller, equal to the reference", async () => {
      const { award } = await s.referenceAward(id, rule.table);
      assert.equal(award.winner, 1, "the reference awards the earlier of the two tied bids");
      assert.equal(award.lowestValidPrice, 100_000n, "the non-compliant lowball is not the lowest valid price");

      const plans: number[][] = [[100], [1], [2], [3], [4], [7], [10], [9, 1, 100], [1, 19], [11, 1, 1, 100], [5, 5, 5, 5]];
      const callerSets = [[stranger], [buyer, stranger], [bidders[5], bidders[1], p1], [bidders[1]]];
      let first: Awaited<ReturnType<typeof snapshotAward>> | null = null;
      for (const [k, pages] of plans.entries()) {
        const snapshot = await s.test.snapshot();
        const { calls, maxGas } = await runPaged(pages, callerSets[k % callerSets.length]!);
        const result = await snapshotAward();
        console.log(`        pages ${JSON.stringify(pages)}: ${calls} call(s), largest ${maxGas} gas`);
        if (first === null) first = result;
        assert.deepEqual(result, first, `page sizes ${JSON.stringify(pages)} changed the award`);
        await s.test.revert({ id: snapshot });
      }
      const result = first!;
      assert.equal(result.winner, award.winner);
      assert.equal(result.lowest, award.lowestValidPrice!.toString());
      for (const scored of award.scored) {
        assert.equal(result.bids[scored.index]!.ruleInput, scored.input);
        assert.equal(result.bids[scored.index]!.score, scored.outcome.score);
        assert.equal(result.bids[scored.index]!.eligible, scored.outcome.eligible);
      }
      // The tie is real: bids 1 and 5 have the same score and price, and the earlier one wins.
      assert.equal(result.bids[1]!.score, result.bids[5]!.score);
      assert.equal(result.bids[1]!.ruleInput, result.bids[5]!.ruleInput);
    });

    it("has no award until both passes are complete", async () => {
      const snapshot = await s.test.snapshot();
      await s.mined(await s.gavelock.write.finalize([id, 3n], { account: stranger.account })); // exactly the walk to the median
      let tender = await s.gavelock.read.getTender([id]);
      // Eight compliant bids: three visits reach the median, and the walk stops there with the floor not yet applied.
      assert.equal(tender.stage, 2);
      assert.equal(tender.scoreCursor, 0);
      assert.equal(tender.awardedAt, 0n);
      assert.equal(await s.phase(id), "Evaluation");
      assert.match(await revertOf(s.gavelock.simulate.challenge([id, 1n, 0, "x"], { account: stranger.account, value: DEPOSIT })), /WrongPhase/);
      assert.match(await revertOf(s.gavelock.simulate.close([id], { account: stranger.account })), /WrongPhase/);
      await s.mined(await s.gavelock.write.finalize([id, 9n], { account: buyer.account })); // one bid short of all ten
      tender = await s.gavelock.read.getTender([id]);
      assert.equal(tender.scoreCursor, 9);
      assert.equal(tender.awardedAt, 0n);
      assert.match(await revertOf(s.gavelock.simulate.finalize([id, 0n], { account: stranger.account })), /NothingToDo/);
      await s.test.revert({ id: snapshot });
    });

    it("refuses to start a rule evaluation without enough gas, instead of mis-scoring the bid", async () => {
      const snapshot = await s.test.snapshot();
      const hash = await s.gavelock.write.finalize([id, 100n], { account: stranger.account, gas: 3_000_000n }).catch((e: unknown) => e);
      const tender = await s.gavelock.read.getTender([id]);
      assert.equal(tender.cancelled, false, "a starved call must not cancel the tender");
      assert.equal(tender.awardedAt, 0n);
      assert.ok(hash instanceof Error || typeof hash === "string");
      await s.test.revert({ id: snapshot });
    });

    it("recomputes through the same paged path when a challenge is upheld", async () => {
      await runPaged([3], [stranger, buyer]);
      const first = await snapshotAward();
      assert.equal(first.winner, 1);
      await s.warpTo((await s.chainNow()) + 5);

      await s.mined(await s.gavelock.write.challenge([id, 1n, 0, "Item 2 is claimed; the certificate is for another company."], { account: bidders[5].account, value: DEPOSIT }));
      await s.mined(await s.gavelock.write.challenge([id, 7n, 1, "The ciphertext does not decrypt to the opened values."], { account: stranger.account, value: DEPOSIT }));
      await s.track("rule on a challenge (upheld)", await s.gavelock.write.rule([id, 0n, true, "Confirmed with the certifier."], { account: buyer.account }));

      let tender = await s.gavelock.read.getTender([id]);
      assert.equal(tender.recomputing, true);
      assert.equal(tender.generation, 1);
      assert.equal(tender.awardedAt, 0n);
      assert.equal(tender.best, 0);
      assert.equal(tender.openChallenges, 1);
      assert.equal((await s.gavelock.read.getBid([id, 1n])).disqualified, true);
      assert.equal(await s.phase(id), "Standstill");
      assert.match(await revertOf(s.gavelock.simulate.close([id], { account: stranger.account })), /WrongPhase/);
      assert.match(await revertOf(s.gavelock.simulate.challenge([id, 5n, 0, "x"], { account: stranger.account, value: DEPOSIT })), /WrongPhase/);

      // Recompute with several page sizes: identical again, and equal to the reference without bid 1.
      const { award } = await s.referenceAward(id, rule.table);
      assert.equal(award.winner, 5, "the tied twin inherits the award");
      let second: Awaited<ReturnType<typeof snapshotAward>> | null = null;
      for (const pages of [[100], [1], [4], [6, 100]]) {
        const snapshot = await s.test.snapshot();
        await runPaged(pages, [bidders[2], stranger]);
        const result = await snapshotAward();
        if (second === null) second = result;
        assert.deepEqual(result, second, `page sizes ${JSON.stringify(pages)} changed the recomputed award`);
        await s.test.revert({ id: snapshot });
      }
      await runPaged([4], [stranger]);
      const after = await snapshotAward();
      assert.deepEqual(after, second);
      assert.equal(after.winner, award.winner);
      assert.equal(after.generation, 1);
      for (const scored of award.scored) {
        assert.equal(after.bids[scored.index]!.score, scored.outcome.score);
        assert.equal(after.bids[scored.index]!.ruleInput, scored.input);
        assert.equal(after.bids[scored.index]!.scoredIn, 2);
      }
      assert.equal(after.bids[1]!.scoredIn, 1, "the disqualified bid keeps its old score and is not scored again");
      tender = await s.gavelock.read.getTender([id]);
      assert.equal(tender.recomputing, false);
      assert.ok(tender.standstillEnd >= tender.awardedAt + BigInt(HOUR), "a recomputed award opens a fresh standstill");
    });

    it("cannot be closed with a challenge open, and can be ended by anyone if the buyer never rules", async () => {
      const tender = await s.gavelock.read.getTender([id]);
      await s.warpTo(Number(tender.standstillEnd));
      assert.match(await revertOf(s.gavelock.simulate.close([id], { account: stranger.account })), /ChallengesOpen/);
      assert.match(await revertOf(s.gavelock.simulate.cancelStalled([id], { account: stranger.account })), /NothingToDo/);
      await s.warpTo(Number(tender.standstillEnd) + HOUR);
      await s.track("end a stalled tender", await s.gavelock.write.cancelStalled([id], { account: stranger.account }));
      assert.equal(await s.phase(id), "Cancelled");
      assert.equal(await s.cancelReason(id), "The buyer did not rule on a challenge in time.");
      assert.equal((await s.gavelock.read.getTender([id])).cancelledBy, zeroAddress);
      // Everyone who opened gets their deposit back, including the disqualified bidder; the unopened one forfeits.
      assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, 1n])), getAddress(bidders[1].account.address));
      // Bid 4 was never opened, but the tender ended because the buyer did not rule, so nothing is forfeited to the buyer.
      assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, 4n])), getAddress(bidders[4].account.address));
      for (let i = 0; i < plan.length; i++) await s.mined(await s.gavelock.write.claimDeposit([id, BigInt(i)], { account: stranger.account }));
    });
  });

  // ==================================================================================== edge cases
  describe("edge cases", () => {
    const toOpeningEnd = async (t: any) => s.warpTo(Number(t.revealEnd));

    it("a tender with no bids ends itself", async () => {
      const { id, t } = await s.createTender({ buyer, rule: "lowest-price" });
      await toOpeningEnd(t);
      await s.mined(await s.gavelock.write.finalize([id, 10n], { account: stranger.account }));
      assert.equal(await s.phase(id), "Cancelled");
      assert.equal(await s.cancelReason(id), "No bid was opened.");
    });

    it("a tender with one bid awards it", async () => {
      const { id, t } = await s.createTender({ buyer, rule: "lowest-price" });
      await s.warpTo(Number(t.biddingStart));
      const only = await s.submitBid(id, bidders[0], { price: 5_000n });
      await s.warpTo(Number(t.deadline));
      await s.mined(await s.openBid(id, only, bidders[0]));
      await toOpeningEnd(t);
      await s.track("finalize: award over 1 bid", await s.gavelock.write.finalize([id, 10n], { account: stranger.account }));
      const after = await s.gavelock.read.getTender([id]);
      assert.equal(after.best, 1);
      assert.equal(after.bestScore, 15);
      await s.warpTo(Number(after.standstillEnd));
      await s.mined(await s.gavelock.write.close([id], { account: stranger.account }));
      assert.equal(await s.phase(id), "Final");
    });

    it("if nothing could be opened, nobody forfeits a deposit", async () => {
      const { id, t } = await s.createTender({ buyer, rule: "lowest-price" });
      await s.warpTo(Number(t.biddingStart));
      await s.submitBid(id, bidders[0], { price: 5_000n });
      await s.submitBid(id, bidders[1], { price: 6_000n });
      await toOpeningEnd(t);
      await s.mined(await s.gavelock.write.finalize([id, 10n], { account: stranger.account }));
      assert.equal(await s.cancelReason(id), "No bid was opened.");
      assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, 0n])), getAddress(bidders[0].account.address));
      assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, 1n])), getAddress(bidders[1].account.address));
    });

    it("a bid that claims no mandatory item cannot win, and a tender with only such bids ends itself", async () => {
      const { id, t } = await s.createTender({ buyer, rule: "lowest-price" });
      await s.warpTo(Number(t.biddingStart));
      const weak = await s.submitBid(id, bidders[0], { price: 5_000n, compliance: 0b00001 });
      await s.warpTo(Number(t.deadline));
      await s.mined(await s.openBid(id, weak, stranger));
      await toOpeningEnd(t);
      await s.mined(await s.gavelock.write.finalize([id, 10n], { account: stranger.account }));
      assert.equal(await s.cancelReason(id), "No bid was eligible.");
      const b = await s.gavelock.read.getBid([id, 0n]);
      assert.equal(b.eligible, false);
      assert.equal(b.ruleInput & 7, 7, "with no valid price every bid sits in the last price band");
    });

    it("a panel that misses its quorum ends the tender", async () => {
      const { id, t } = await s.createTender({ buyer, panel: [p1, p2], quorum: 2, rule: "quality-70-price-30" });
      await s.warpTo(Number(t.biddingStart));
      const one = await s.submitBid(id, bidders[0], { price: 5_000n });
      await s.warpTo(Number(t.deadline));
      await s.mined(await s.openBid(id, one, stranger));
      await s.warpTo(Number(t.openingEnd));
      await s.mined(await s.panel.write.commitScores([id, s.scoreCommitment(id, p1.account.address, [80], salt(31))], { account: p1.account }));
      await s.mined(await s.panel.write.commitScores([id, s.scoreCommitment(id, p2.account.address, [70], salt(32))], { account: p2.account }));
      await s.warpTo(Number(t.commitEnd));
      await s.mined(await s.panel.write.revealScores([id, "0x50", salt(31)], { account: p1.account }));
      await s.warpTo(Number(t.revealEnd));
      await s.mined(await s.gavelock.write.finalize([id, 10n], { account: stranger.account }));
      assert.equal(await s.cancelReason(id), "The evaluation panel did not reach its quorum.");
      assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, 0n])), getAddress(bidders[0].account.address));
    });

    it("the buyer can cancel with a public reason, and every deposit goes back", async () => {
      const { id, t } = await s.createTender({ buyer, rule: "lowest-price" });
      await s.warpTo(Number(t.biddingStart));
      await s.submitBid(id, bidders[0], { price: 5_000n });
      assert.match(await revertOf(s.gavelock.simulate.cancel([id, "not yours"], { account: stranger.account })), /NotBuyer/);
      assert.match(await revertOf(s.gavelock.simulate.cancel([id, ""], { account: buyer.account })), /BadLength/);
      assert.match(await revertOf(s.gavelock.simulate.claimDeposit([id, 0n], { account: stranger.account })), /WrongPhase/);
      const receipt = await s.track("cancel a tender", await s.gavelock.write.cancel([id, "Funding for this lot was withdrawn by the donor."], { account: buyer.account }));
      assert.equal(await s.phase(id), "Cancelled");
      assert.equal(await s.cancelReason(id), "Funding for this lot was withdrawn by the donor.");
      const after = await s.gavelock.read.getTender([id]);
      assert.equal(getAddress(after.cancelledBy), getAddress(buyer.account.address));
      assert.equal(after.endedBlock, receipt.blockNumber);
      assert.match(await revertOf(s.gavelock.simulate.submitBid([id, salt(5), "0x01"], { account: bidders[1].account, value: DEPOSIT })), /WrongPhase/);
      assert.match(await revertOf(s.gavelock.simulate.cancel([id, "twice"], { account: buyer.account })), /WrongPhase/);
      const before = await s.pub.getBalance({ address: bidders[0].account.address });
      await s.mined(await s.gavelock.write.claimDeposit([id, 0n], { account: stranger.account }));
      assert.equal((await s.pub.getBalance({ address: bidders[0].account.address })) - before, DEPOSIT);
    });

    it("a copied commitment and ciphertext cannot be opened by the copier", async () => {
      const { id, t } = await s.createTender({ buyer, rule: "lowest-price" });
      await s.warpTo(Number(t.biddingStart));
      const honest = await s.submitBid(id, bidders[0], { price: 5_000n });
      await s.mined(await s.gavelock.write.submitBid([id, honest.commitment, honest.ciphertext], { account: bidders[1].account, value: DEPOSIT }));
      await s.warpTo(Number(t.deadline));
      const copy = { ...honest, index: 1n };
      assert.match(await revertOf(s.openBid(id, copy, bidders[1])), /CommitmentMismatch/);
      await s.mined(await s.openBid(id, honest, stranger));
      await toOpeningEnd(t);
      await s.mined(await s.gavelock.write.finalize([id, 10n], { account: stranger.account }));
      assert.equal((await s.gavelock.read.getTender([id])).best, 1);
      // The copier's bid is void and, since another bid was opened, their deposit is forfeited.
      const after = await s.gavelock.read.getTender([id]);
      await s.warpTo(Number(after.standstillEnd));
      await s.mined(await s.gavelock.write.close([id], { account: stranger.account }));
      assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, 1n])), getAddress(buyer.account.address));
    });

    it("refuses a tender whose deposit is below the minimum, so slots cannot be filled for free", async () => {
      const now = await s.chainNow();
      const params = { quick: false, ruleId: s.rules["lowest-price"].id, clarificationsStart: 0n, biddingStart: BigInt(now + HOUR), deadline: BigInt(now + 2 * HOUR), openingWindow: HOUR, commitWindow: 0, revealWindow: 0, standstill: HOUR, bidDeposit: parseEther("0.001") - 1n, checklistItems: 0, mandatoryMask: 0, preferredAMask: 0, preferredBMask: 0, priceLadderBps: [0, 250, 500, 1000, 1500, 2500, 4000], deliveryLadderDays: [7, 14, 30], abnormalFloorBps: 7000, panel: [] as string[], quorum: 0, terms: "0x7b7d" as Hex };
      assert.match(await revertOf(s.gavelock.simulate.createTender([params], { account: buyer.account, value: TENDER_FEE })), /BadDeposit/);
      assert.equal(await revertOf(s.gavelock.simulate.createTender([{ ...params, bidDeposit: parseEther("0.001") }], { account: buyer.account, value: TENDER_FEE })), "");
    });
  });

  // ==================================================================================== quick quote
  describe("Quick Quote", () => {
    it("is free to create, needs three opened quotes, and awards the fastest compliant delivery", async () => {
      const feesBefore = await s.gavelock.read.feesAccrued();
      const { id, t, rule } = await s.createTender({ buyer, quick: true });
      assert.equal(await s.gavelock.read.feesAccrued(), feesBefore, "a Quick Quote pays no fee");
      assert.equal(t.quick, true);
      assert.equal(t.panelSize, 0);
      assert.equal(t.revealEnd, t.openingEnd);
      await s.warpTo(Number(t.biddingStart));
      const quotes = [
        await s.submitBid(id, bidders[0], { price: 900n, deliveryDays: 20 }),
        await s.submitBid(id, bidders[1], { price: 1_500n, deliveryDays: 5 }),
        await s.submitBid(id, bidders[2], { price: 1_400n, deliveryDays: 6 }),
        await s.submitBid(id, bidders[3], { price: 100n, deliveryDays: 1, compliance: 0 }),
      ];
      await s.warpTo(Number(t.deadline));
      for (const q of quotes) await s.mined(await s.openBid(id, q, stranger));
      await s.warpTo(Number(t.openingEnd));
      await s.track("finalize: award over 4 quotes", await s.gavelock.write.finalize([id, 100n], { account: stranger.account }));
      const { award, chain, t: after } = await s.referenceAward(id, rule.table);
      assert.deepEqual(award.ranking, [2, 1, 0]); // 6 and 5 days share a band; the cheaper quote wins
      assert.equal(after.best - 1, award.winner);
      for (const scored of award.scored) {
        assert.equal(chain[scored.index].score, scored.outcome.score);
        assert.equal(chain[scored.index].ruleInput, scored.input);
      }
      assert.equal(chain[3].eligible, false);
    });

    it("ends itself when fewer than three quotes are opened, forfeiting only the unopened one", async () => {
      const { id, t } = await s.createTender({ buyer, quick: true });
      await s.warpTo(Number(t.biddingStart));
      const a = await s.submitBid(id, bidders[0], { price: 900n });
      const b = await s.submitBid(id, bidders[1], { price: 950n });
      await s.submitBid(id, bidders[2], { price: 990n });
      await s.warpTo(Number(t.deadline));
      await s.mined(await s.openBid(id, a, stranger));
      await s.mined(await s.openBid(id, b, stranger));
      await s.warpTo(Number(t.openingEnd));
      await s.mined(await s.gavelock.write.finalize([id, 100n], { account: stranger.account }));
      assert.equal(await s.cancelReason(id), "Fewer than three quotes were opened.");
      assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, 0n])), getAddress(bidders[0].account.address));
      assert.equal(getAddress(await s.gavelock.read.depositRecipient([id, 2n])), getAddress(buyer.account.address));
    });
  });

  // ==================================================================================== documents (Gate A condition 2)
  describe("documents as contract code (Gate A condition 2)", () => {
    it("stores 100 KB for less than 0.001 OKB", async () => {
      const { id } = await s.createTender({ buyer, rule: "lowest-price" });
      const data = filler(100_000, 3);
      let gas = 0n;
      const CHUNK = 24_000;
      for (let offset = 0, k = 0; offset < data.length; offset += CHUNK, k++) {
        const chunk = bytesToHex(data.subarray(offset, offset + CHUNK));
        const hash = k === 0 ? await s.records.write.publishDocument([id, "tender-pack.pdf", "application/pdf", sha256(data), data.length, chunk], { account: buyer.account }) : await s.records.write.appendDocument([id, 0n, chunk], { account: buyer.account });
        const receipt = await s.track(`document chunk (${Math.min(CHUNK, data.length - offset).toLocaleString("en-US")} bytes)`, hash);
        gas += receipt.gasUsed;
      }
      const cost = gas * GAS_PRICE;
      console.log(`        100,000 bytes in 5 chunks: ${gas} gas = ${formatEther(cost)} OKB`);
      s.gas.push({ step: "a 100,000-byte document in total", gas });
      assert.ok(cost < parseEther("0.001"), `100 KB costs ${formatEther(cost)} OKB`);
      const doc = await s.records.read.getDocument([id, 0n]);
      assert.notEqual(doc.completedBlock, 0n);
      const stored = Buffer.concat(await Promise.all(doc.chunks.map(async (c: string) => Buffer.from(hexToBytes(await s.records.read.read([c]))))));
      assert.equal(sha256(stored), sha256(data));
    });

    it("completes the largest allowed document (1 MiB) with the hash check inside one transaction", async () => {
      const { id } = await s.createTender({ buyer, rule: "lowest-price" });
      const data = filler(2 ** 20, 5);
      const CHUNK = 24_575;
      let last: any;
      let total = 0n;
      for (let offset = 0, k = 0; offset < data.length; offset += CHUNK, k++) {
        const chunk = bytesToHex(data.subarray(offset, offset + CHUNK));
        const hash = k === 0 ? await s.records.write.publishDocument([id, "full.bin", "", sha256(data), data.length, chunk], { account: buyer.account }) : await s.records.write.appendDocument([id, 0n, chunk], { account: buyer.account });
        last = await s.mined(hash);
        total += last.gasUsed;
      }
      console.log(`        1 MiB in 43 chunks: ${total} gas = ${formatEther(total * GAS_PRICE)} OKB; the last chunk, with the hash check, used ${last.gasUsed} gas`);
      s.gas.push({ step: "last chunk of a 1 MiB document (hashes the whole file)", gas: last.gasUsed });
      assert.ok(last.gasUsed < 15_000_000n);
      assert.equal((await s.records.read.getDocument([id, 0n])).sha256Hash, sha256(data));
      assert.notEqual((await s.records.read.getDocument([id, 0n])).completedBlock, 0n);
    });
  });
});
