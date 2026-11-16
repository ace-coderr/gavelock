// What the tender contract does when a rule circuit misbehaves: reverts, returns the wrong width,
// returns bits it should not, burns all its gas, or returns something that is not ABI-encoded bytes.
// In every case the tender must end with a public reason and release deposits, never hang or mis-award.
// Runs on a plain in-memory chain with a test double for the circuit; no network access.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, parseEther, type Hex } from "viem";
import { commitmentOf, type Bid } from "@gavelock/core";

const HOUR = 3600;
const DEPOSIT = parseEther("0.01");
const MODES = { GOOD: 0, REVERTS: 1, TWO_BYTES: 2, SIX_BITS: 3, BURNS_GAS: 4, RAW_WORD: 5, EMPTY: 6 } as const;

describe("a misbehaving rule circuit", () => {
  let viem: any, pub: any, test: any;
  let mock: any, gavelock: any;
  let buyer: any, bidder: any, stranger: any, feeRecipient: any;
  let chainId: number;

  before(async () => {
    ({ viem } = await network.create());
    pub = await viem.getPublicClient();
    test = await viem.getTestClient();
    [, feeRecipient, buyer, bidder, stranger] = await viem.getWalletClients();
    chainId = await pub.getChainId();
    mock = await viem.deployContract("MockRuleSource");
    gavelock = await viem.deployContract("Gavelock", [mock.address, feeRecipient.account.address, 0n]);
  });

  const mined = async (hash: Hex) => {
    const receipt = await pub.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt;
  };
  const warpTo = async (timestamp: bigint) => {
    await test.setNextBlockTimestamp({ timestamp });
    await test.mine({ blocks: 1 });
  };

  /** A tender with one opened bid, ready to be finalized. */
  async function readyTender() {
    const now = Number((await pub.getBlock()).timestamp) + 10;
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
      checklistItems: 0,
      mandatoryMask: 0,
      preferredAMask: 0,
      preferredBMask: 0,
      priceLadderBps: [0, 250, 500, 1000, 1500, 2500, 4000],
      deliveryLadderDays: [7, 14, 30],
      panel: [],
      quorum: 0,
      terms: "0x7b7d",
    };
    const { result: id } = await gavelock.simulate.createTender([params], { account: buyer.account });
    await mined(await gavelock.write.createTender([params], { account: buyer.account }));
    const bid: Bid = { price: 1000n, deliveryDays: 5, compliance: 0, note: "", salt: `0x${"11".repeat(32)}` };
    const commitment = commitmentOf({ chainId, contract: gavelock.address, tenderId: id, bidder: bidder.account.address }, bid);
    await warpTo(params.biddingStart);
    await mined(await gavelock.write.submitBid([id, commitment, "0x01"], { account: bidder.account, value: DEPOSIT }));
    await warpTo(params.deadline);
    await mined(await gavelock.write.openBid([id, 0n, bid.price, bid.deliveryDays, bid.compliance, bid.note, bid.salt], { account: stranger.account }));
    await warpTo(params.deadline + BigInt(HOUR));
    return id as bigint;
  }

  const reasonOf = async (id: bigint) => {
    const t = await gavelock.read.getTender([id]);
    return Buffer.from(((await gavelock.read.read([t.cancelReason])) as Hex).slice(2), "hex").toString("utf8");
  };

  for (const [name, mode] of Object.entries(MODES).filter(([name]) => name !== "GOOD")) {
    it(`ends the tender and releases the deposit when the circuit ${name.toLowerCase().replace("_", " ")}`, async () => {
      const id = await readyTender();
      await mined(await mock.write.set([mode, 0]));
      const receipt = await mined(await gavelock.write.finalize([id, 10n], { account: stranger.account, gas: 8_000_000n }));
      const t = await gavelock.read.getTender([id]);
      assert.equal(t.cancelled, true);
      assert.equal(t.best, 0);
      assert.equal(await reasonOf(id), "The rule circuit did not return a valid result.");
      assert.ok(receipt.gasUsed < 6_000_000n, `finalize used ${receipt.gasUsed} gas`);
      const before = await pub.getBalance({ address: bidder.account.address });
      assert.equal(getAddress(await gavelock.read.depositRecipient([id, 0n])), getAddress(bidder.account.address));
      await mined(await gavelock.write.claimDeposit([id, 0n], { account: stranger.account }));
      assert.equal((await pub.getBalance({ address: bidder.account.address })) - before, DEPOSIT);
    });
  }

  it("reads a well-formed result: eligible with score 15", async () => {
    const id = await readyTender();
    await mined(await mock.write.set([MODES.GOOD, 0b11111]));
    await mined(await gavelock.write.finalize([id, 10n], { account: stranger.account }));
    const t = await gavelock.read.getTender([id]);
    assert.equal(t.cancelled, false);
    assert.equal(t.best, 1);
    assert.equal(t.bestScore, 15);
    const b = await gavelock.read.getBid([id, 0n]);
    assert.equal(b.eligible, true);
    assert.equal(b.score, 15);
  });

  it("ignores score bits on an ineligible result", async () => {
    const id = await readyTender();
    await mined(await mock.write.set([MODES.GOOD, 0b11110])); // score bits set, eligible bit clear
    await mined(await gavelock.write.finalize([id, 10n], { account: stranger.account }));
    assert.equal(await reasonOf(id), "No bid was eligible.");
    const b = await gavelock.read.getBid([id, 0n]);
    assert.equal(b.eligible, false);
    assert.equal(b.score, 0);
  });

  it("will not start an evaluation it cannot fund, so a healthy circuit is never blamed", async () => {
    const id = await readyTender();
    await mined(await mock.write.set([MODES.GOOD, 0b11111]));
    const failed = await gavelock.write.finalize([id, 10n], { account: stranger.account, gas: 2_000_000n }).then(
      async (hash: Hex) => (await pub.waitForTransactionReceipt({ hash })).status !== "success",
      () => true,
    );
    assert.equal(failed, true, "the under-funded call reverts");
    const t = await gavelock.read.getTender([id]);
    assert.equal(t.cancelled, false);
    assert.equal(t.awardedAt, 0n);
    await mined(await gavelock.write.finalize([id, 10n], { account: stranger.account }));
    assert.equal((await gavelock.read.getTender([id])).best, 1);
  });
});
