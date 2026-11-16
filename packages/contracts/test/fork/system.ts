// Deploys the whole Gavelock system on the fork and provides the helpers the lifecycle tests share.
import { bytesToHex, encodeAbiParameters, getAddress, keccak256, parseEther, type Address, type Hex } from "viem";
import {
  DEFAULT_LADDERS,
  STARTER_RULES,
  TAPEOUT,
  commitmentOf,
  compileRule,
  computeAward,
  encodeBid,
  encodeNetlist,
  medianScore,
  randomSalt,
  truthTable,
  type Bid,
  type Checklist,
  type OpenedBid,
  type TruthTable,
} from "@gavelock/core";
import { seal } from "@gavelock/core/seal";
import { connectFork, erc20Abi, tapeoutAbi } from "./helpers.ts";

export const TENDER_FEE = parseEther("0.01");
export const RULE_FEE = parseEther("0.002");
export const TAPEOUT_FEE = parseEther("0.0013");
export const DEPOSIT = parseEther("0.005");
export const HOUR = 3600;
/** X Layer's gas price on 16 November 2026, used to turn measured gas into OKB. */
export const GAS_PRICE = 20_000_001n;

export const PHASES = ["Published", "Clarifications", "Bidding", "Opening", "Evaluation", "Awarded", "Standstill", "Final", "Cancelled"] as const;
export const CHECKLIST: Checklist = { items: 5, mandatoryMask: 0b00011, preferredAMask: 0b00100, preferredBMask: 0b11000 };

export type RuleKey = (typeof STARTER_RULES)[number]["key"];

export async function deploySystem() {
  const fork = await connectFork();
  const { viem, pub, test, wallets, mined } = fork;
  const [deployer, feeRecipient] = wallets as any[];

  const stock = (await viem.deployContract("RuleStock", [
    TAPEOUT.factory,
    feeRecipient.account.address,
    RULE_FEE,
    100_000_000n,
    "Gavelock",
    "GAVEL",
    "Tamper-proof tenders. Every scoring rule is a circuit taped out here.",
  ])) as any;
  const deployFee = (await pub.readContract({ address: TAPEOUT.factory, abi: tapeoutAbi, functionName: "deployFee" })) as bigint;
  const needed = deployFee + deployFee / 10n;
  await fork.fundFeeToken(deployer.account.address, needed);
  await mined(await deployer.writeContract({ address: TAPEOUT.bem, abi: erc20Abi, functionName: "approve", args: [stock.address, needed] }));
  await mined(await stock.write.open({ account: deployer.account }));

  const rules = {} as Record<RuleKey, { id: number; table: TruthTable; gates: number }>;
  for (const rule of STARTER_RULES) {
    const table = truthTable(rule.spec);
    const compiled = compileRule(table);
    const netlist = bytesToHex(encodeNetlist(compiled.netlist));
    const { result } = await stock.simulate.tapeOut([netlist, rule.name], { value: TAPEOUT_FEE + RULE_FEE, account: deployer.account });
    await mined(await stock.write.tapeOut([netlist, rule.name], { value: TAPEOUT_FEE + RULE_FEE, account: deployer.account }));
    rules[rule.key] = { id: Number(result), table, gates: compiled.gates };
  }

  const { contract: gavelock, deploymentTransaction } = (await viem.sendDeploymentTransaction("Gavelock", [stock.address, feeRecipient.account.address, TENDER_FEE])) as any;
  const deployReceipt = await mined(deploymentTransaction.hash);
  const panel = (await viem.getContractAt("TenderPanel", await gavelock.read.panel())) as any;
  const records = (await viem.getContractAt("TenderRecords", await gavelock.read.records())) as any;

  // ---------------------------------------------------------------- time
  const chainNow = async () => Number((await pub.getBlock()).timestamp);
  /** Move the chain clock to `timestamp` (or one second on, if it is already past). */
  const warpTo = async (timestamp: number) => {
    const current = await chainNow();
    await test.setNextBlockTimestamp({ timestamp: BigInt(Math.max(timestamp, current + 1)) });
    await test.mine({ blocks: 1 });
  };

  // ---------------------------------------------------------------- gas ledger
  const gas: { step: string; gas: bigint }[] = [];
  const track = async (step: string, hash: Hex) => {
    const receipt = await mined(hash);
    gas.push({ step, gas: receipt.gasUsed });
    return receipt;
  };
  gas.push({ step: "deploy Gavelock (with its panel and records contracts)", gas: deployReceipt.gasUsed });

  // ---------------------------------------------------------------- tenders
  interface TenderOptions {
    quick?: boolean;
    rule?: RuleKey;
    panel?: any[];
    quorum?: number;
    deposit?: bigint;
    checklist?: Checklist;
    buyer: any;
  }
  /** Create a tender whose phases are each an hour long, starting an hour from now. */
  async function createTender(o: TenderOptions) {
    const quick = o.quick ?? false;
    const panelMembers = (o.panel ?? []).map((w) => w.account.address as Address);
    const start = (await chainNow()) + 10;
    const checklist = o.checklist ?? CHECKLIST;
    const params = {
      quick,
      ruleId: rules[o.rule ?? (quick ? "fastest-delivery" : "price-60-quality-40")].id,
      clarificationsStart: 0n,
      biddingStart: BigInt(start + HOUR),
      deadline: BigInt(start + 2 * HOUR),
      openingWindow: HOUR,
      commitWindow: panelMembers.length ? HOUR : 0,
      revealWindow: panelMembers.length ? HOUR : 0,
      standstill: HOUR,
      bidDeposit: o.deposit ?? DEPOSIT,
      checklistItems: checklist.items,
      mandatoryMask: checklist.mandatoryMask,
      preferredAMask: checklist.preferredAMask,
      preferredBMask: checklist.preferredBMask,
      priceLadderBps: [...DEFAULT_LADDERS.priceBps],
      deliveryLadderDays: [...DEFAULT_LADDERS.deliveryDays],
      panel: panelMembers,
      quorum: o.quorum ?? (panelMembers.length ? Math.ceil(panelMembers.length / 2) : 0),
      terms: bytesToHex(new TextEncoder().encode(JSON.stringify({ title: "Fork test tender", currency: "USD", decimals: 2, checklist: ["Registered", "Tax clearance", "ISO 9001", "Local office", "Two references"] }))),
    };
    const value = quick ? 0n : TENDER_FEE;
    const { result: id } = await gavelock.simulate.createTender([params], { account: o.buyer.account, value });
    const receipt = await track(`create ${quick ? "Quick Quote" : "full tender"}`, await gavelock.write.createTender([params], { account: o.buyer.account, value }));
    const t = await gavelock.read.getTender([id]);
    return { id: id as bigint, params, t, receipt, rule: rules[o.rule ?? (quick ? "fastest-delivery" : "price-60-quality-40")] };
  }

  type Sealed = { index: bigint; bidder: any; bid: Bid; commitment: Hex; ciphertext: Hex };
  /** Seal a bid in the way the app does and submit it. */
  async function submitBid(id: bigint, bidder: any, fields: Partial<Bid> & { price: bigint }, deposit = DEPOSIT): Promise<Sealed> {
    const t = await gavelock.read.getTender([id]);
    const bid: Bid = { deliveryDays: 10, compliance: 0b00011, note: "", salt: randomSalt(), ...fields };
    const commitment = commitmentOf({ chainId: 196, contract: gavelock.address, tenderId: id, bidder: bidder.account.address }, bid);
    const ciphertext = bytesToHex(await seal(encodeBid(bid), Number(t.drandRound)));
    const index = (await gavelock.read.bidCount([id])) as bigint;
    await track("submit a sealed bid", await gavelock.write.submitBid([id, commitment, ciphertext], { account: bidder.account, value: deposit }));
    return { index, bidder, bid, commitment, ciphertext };
  }

  const openBid = (id: bigint, s: Sealed, opener: any) =>
    gavelock.write.openBid([id, s.index, s.bid.price, s.bid.deliveryDays, s.bid.compliance, s.bid.note, s.bid.salt], { account: opener.account });

  const scoreCommitment = (id: bigint, member: Address, scores: number[], salt: Hex) =>
    keccak256(
      encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "bytes" }, { type: "bytes32" }], [
        196n,
        gavelock.address,
        id,
        member,
        bytesToHex(Uint8Array.from(scores)),
        salt,
      ]),
    );

  /** What the core library says the award should be, from the chain's own opened bids and revealed scores. */
  async function referenceAward(id: bigint, table: TruthTable, checklist: Checklist = CHECKLIST) {
    const t = await gavelock.read.getTender([id]);
    const count = Number(await gavelock.read.bidCount([id]));
    const members: Address[] = t.panelSize ? await panel.read.panelOf([id]) : [];
    const revealed: number[][] = [];
    for (const m of members) {
      const member = await panel.read.memberOf([id, m]);
      if (member.revealedBlock !== 0n) revealed.push([...Buffer.from(member.scores.slice(2), "hex")]);
    }
    const opened: OpenedBid[] = [];
    const chain: any[] = [];
    for (let i = 0; i < count; i++) {
      const b = await gavelock.read.getBid([id, BigInt(i)]);
      chain.push(b);
      if (!b.opened) continue;
      opened.push({
        index: i,
        price: b.price,
        deliveryDays: b.deliveryDays,
        compliance: b.compliance,
        disqualified: b.disqualified,
        panelMedian: revealed.length ? medianScore(revealed.map((scores) => scores[i]!)) : null,
      });
    }
    return { award: computeAward(opened, DEFAULT_LADDERS, checklist, table), chain, t };
  }

  const phase = async (id: bigint) => PHASES[Number(await gavelock.read.phaseOf([id]))]!;
  const cancelReason = async (id: bigint) => {
    const t = await gavelock.read.getTender([id]);
    return Buffer.from(((await gavelock.read.read([t.cancelReason])) as Hex).slice(2), "hex").toString("utf8");
  };

  return { ...fork, stock, gavelock, panel, records, rules, deployer, feeRecipient, chainNow, warpTo, gas, track, createTender, submitBid, openBid, scoreCommitment, referenceAward, phase, cancelReason, getAddress };
}

export type System = Awaited<ReturnType<typeof deploySystem>>;
