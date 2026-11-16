// Gate A condition 1, proven against the real TapeOut contracts on a fork of X Layer mainnet:
//  - the processor is created and its entire transistor supply minted to the stock in one transaction;
//  - nobody else can mint, and the stock cannot be emptied except by tape-outs;
//  - a caller with no fee token and no transistors tapes out a rule for OKB only and owns the circuit;
//  - the rule fee reaches Gavelock's fee address;
//  - what was taped out behaves exactly like the truth table it was compiled from.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { bytesToHex, encodeFunctionData, getAddress, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { INPUT_SPACE, MULTICALL3, STARTER_RULES, TAPEOUT, compileRule, decodeNetlist, encodeNetlist, firstMismatch, inputToBytes, truthTable } from "@gavelock/core";
import { connectFork, erc20Abi, revertOf, tapeoutAbi } from "./helpers.ts";

const SUPPLY = 100_000_000n;
const RULE_FEE = parseEther("0.002");
const TAPEOUT_FEE = parseEther("0.0013");
const NAME = "Gavelock";
const SYMBOL = "GAVEL";
const STORY = "Tamper-proof tenders. Every scoring rule is a circuit taped out here; awards are computed by calling it.";

describe("RuleStock on a fork of X Layer", () => {
  let fork: Awaited<ReturnType<typeof connectFork>>;
  let stock: any;
  let circuits: Address;
  let transistors: Address;
  let deployer: any, buyer: any, stranger: any, feeRecipient: any;
  let openGas: bigint;
  const compiled = STARTER_RULES.map((r) => ({ rule: r, table: truthTable(r.spec), ...compileRule(truthTable(r.spec)) }));
  const ids: bigint[] = [];

  const read = <T>(address: Address, functionName: string, args: readonly unknown[] = []) =>
    fork.pub.readContract({ address, abi: tapeoutAbi, functionName, args } as never) as Promise<T>;
  const feeToken = <T>(functionName: string, args: readonly unknown[]) =>
    fork.pub.readContract({ address: TAPEOUT.bem, abi: erc20Abi, functionName, args } as never) as Promise<T>;

  before(async () => {
    fork = await connectFork();
    [deployer, buyer, stranger, feeRecipient] = fork.wallets;
    stock = await fork.viem.deployContract("RuleStock", [TAPEOUT.factory, feeRecipient.account.address, RULE_FEE, SUPPLY, NAME, SYMBOL, STORY]);
  });

  it("is closed until opened", async () => {
    assert.equal(await stock.read.circuits(), zeroAddress);
    assert.equal(await stock.read.stockRemaining(), 0n);
    assert.match(await revertOf(stock.simulate.tapeOut([bytesToHex(encodeNetlist(compiled[0]!.netlist)), "x"], { value: TAPEOUT_FEE + RULE_FEE, account: buyer.account })), /NotOpen/);
  });

  it("cannot be opened without the fee token", async () => {
    assert.notEqual(await revertOf(stock.simulate.open({ account: stranger.account })), "");
  });

  it("creates the processor and mints the whole supply to itself in one transaction", async () => {
    const deployFee = await read<bigint>(TAPEOUT.factory, "deployFee");
    const processorsBefore = await read<bigint>(TAPEOUT.factory, "cpuCount");
    // 0.1 for the processor + 0.01 for the single mint call, as measured in Task 0.
    const needed = deployFee + deployFee / 10n;
    await fork.fundFeeToken(deployer.account.address, needed);
    await fork.mined(await deployer.writeContract({ address: TAPEOUT.bem, abi: erc20Abi, functionName: "approve", args: [stock.address, needed] }));

    const receipt = await fork.mined(await stock.write.open({ account: deployer.account }));
    openGas = receipt.gasUsed;

    circuits = getAddress(await stock.read.circuits());
    transistors = getAddress(await stock.read.transistors());
    assert.equal(await read<bigint>(TAPEOUT.factory, "cpuCount"), processorsBefore + 1n);
    assert.equal(await read<boolean>(TAPEOUT.factory, "isCPU", [circuits]), true);
    assert.equal(await read<string>(circuits, "name"), NAME);
    assert.equal(getAddress(await read<Address>(transistors, "creator")), getAddress(stock.address));
    assert.equal(await read<bigint>(transistors, "mintPrice"), 0n);
    assert.equal(await read<bigint>(transistors, "supplyCap"), SUPPLY);
    assert.equal(await read<bigint>(transistors, "minted"), SUPPLY);
    assert.equal(await read<bigint>(transistors, "balanceOf", [stock.address, 0n]), SUPPLY);
    assert.equal(await stock.read.stockRemaining(), SUPPLY);
    // Exactly the two fees were taken; nothing is left behind in the stock or approved to anyone.
    assert.equal(await feeToken<bigint>("balanceOf", [deployer.account.address]), 0n);
    assert.equal(await feeToken<bigint>("balanceOf", [stock.address]), 0n);
    assert.equal(await feeToken<bigint>("allowance", [stock.address, TAPEOUT.factory]), 0n);
    assert.equal(await feeToken<bigint>("allowance", [stock.address, transistors]), 0n);
    assert.ok(openGas < 2_000_000n, `open used ${openGas} gas`);
  });

  it("cannot be opened twice", async () => {
    assert.match(await revertOf(stock.simulate.open({ account: deployer.account })), /AlreadyOpen/);
  });

  it("leaves nobody able to mint a transistor, of either type, even with the fee paid", async () => {
    const mintFee = await read<bigint>(transistors, "protocolFee");
    await fork.fundFeeToken(stranger.account.address, mintFee * 4n);
    await fork.mined(await stranger.writeContract({ address: TAPEOUT.bem, abi: erc20Abi, functionName: "approve", args: [transistors, mintFee * 4n] }));
    for (const [id, amount] of [[0n, 1n], [1n, 1n], [0n, 1000n]] as const) {
      const reason = await revertOf(fork.pub.simulateContract({ account: stranger.account, address: transistors, abi: tapeoutAbi, functionName: "mint", args: [id, amount] }));
      assert.match(reason, /supply cap/, `mint(${id}, ${amount}) should hit the cap, got: ${reason}`);
    }
    assert.equal(await read<bigint>(transistors, "minted"), SUPPLY);
  });

  it("has no way to move transistors out, and refuses any sent in", async () => {
    const functions = (stock.abi as any[]).filter((f) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure").map((f) => f.name).sort();
    // The only functions that can change state: none of them transfers a transistor.
    assert.deepEqual(functions, ["open", "tapeOut", "withdrawFees"]);
    // A stranger cannot pull them either: the stock never approved anyone.
    const pull = fork.pub.simulateContract({ account: stranger.account, address: transistors, abi: tapeoutAbi, functionName: "safeTransferFrom", args: [stock.address, stranger.account.address, 0n, 1n, "0x"] });
    assert.notEqual(await revertOf(pull), "");
  });

  it("without transistors, a tape-out straight on the processor fails", async () => {
    const direct = fork.pub.simulateContract({ account: buyer.account, address: circuits, abi: tapeoutAbi, functionName: "tapeout", args: [bytesToHex(encodeNetlist(compiled[0]!.netlist)), 11, 5], value: TAPEOUT_FEE });
    assert.notEqual(await revertOf(direct), "");
  });

  it("tapes out the four starter rules for OKB only; the caller owns each circuit and the fee is accrued", async () => {
    assert.equal(await stock.read.tapeOutPrice(), TAPEOUT_FEE + RULE_FEE);
    assert.equal(await feeToken<bigint>("balanceOf", [buyer.account.address]), 0n);
    assert.equal(await read<bigint>(transistors, "balanceOf", [buyer.account.address, 0n]), 0n);
    let burned = 0n;
    for (const c of compiled) {
      const netlist = bytesToHex(encodeNetlist(c.netlist));
      const before = await fork.pub.getBalance({ address: buyer.account.address });
      const { result: id } = await stock.simulate.tapeOut([netlist, c.rule.name], { value: TAPEOUT_FEE + RULE_FEE, account: buyer.account });
      const receipt = await fork.mined(await stock.write.tapeOut([netlist, c.rule.name], { value: TAPEOUT_FEE + RULE_FEE, account: buyer.account }));
      const after = await fork.pub.getBalance({ address: buyer.account.address });
      ids.push(id);
      burned += BigInt(c.gates);

      assert.equal(getAddress(await read<Address>(circuits, "ownerOf", [id])), getAddress(buyer.account.address));
      assert.deepEqual((await read<readonly number[]>(circuits, "circuitInfo", [id])).map(Number), [11, 5, 0, c.gates]);
      assert.equal(await read<Hex>(circuits, "netlist", [id]), netlist);
      assert.equal(await stock.read.isRule([id]), true);
      const [author, gates, blockNumber, label] = await stock.read.rule([id]);
      assert.equal(getAddress(author), getAddress(buyer.account.address));
      assert.equal(gates, c.gates);
      assert.equal(blockNumber, receipt.blockNumber);
      assert.equal(label, c.rule.name);
      // The caller paid the two fees and gas, nothing else.
      assert.equal(before - after, TAPEOUT_FEE + RULE_FEE + receipt.gasUsed * receipt.effectiveGasPrice);
      console.log(`      ${c.rule.name}: circuit ${id}, ${c.gates} NAND, ${receipt.gasUsed} gas`);
    }
    assert.equal(await stock.read.stockRemaining(), SUPPLY - burned);
    assert.equal(await stock.read.feesAccrued(), RULE_FEE * 4n);
    assert.equal(await stock.read.ruleCount(), 4n);
    assert.deepEqual(await stock.read.ruleIds([0n, 10n]), ids);
    assert.deepEqual(await stock.read.ruleIds([1n, 2n]), ids.slice(1, 3));
    assert.deepEqual(await stock.read.ruleIds([9n, 2n]), []);
    assert.equal(await fork.pub.getBalance({ address: stock.address }), RULE_FEE * 4n);
  });

  it("every taped-out rule returns its truth table through eval, on all 2,048 inputs", async () => {
    for (const [k, c] of compiled.entries()) {
      const id = ids[k]!;
      // What the chain stores decodes to a circuit equal to the table (local simulator)...
      const stored = await read<Hex>(circuits, "netlist", [id]);
      assert.equal(firstMismatch(decodeNetlist(Buffer.from(stored.slice(2), "hex"), 11, 5), c.table), null);
      // ...and the chain's own evaluation agrees, input by input.
      let checked = 0;
      for (let base = 0; base < INPUT_SPACE; base += 128) {
        const calls = Array.from({ length: 128 }, (_, i) => ({
          target: circuits,
          allowFailure: false,
          callData: encodeFunctionData({ abi: tapeoutAbi, functionName: "eval", args: [id, bytesToHex(inputToBytes(base + i))] }),
        }));
        const results = (await fork.pub.readContract({ address: MULTICALL3, abi: tapeoutAbi, functionName: "aggregate3", args: [calls], gas: 150_000_000n } as never)) as { returnData: Hex }[];
        results.forEach((r, i) => {
          // ABI-encoded bytes: offset, length, data.
          const length = Number(BigInt(`0x${r.returnData.slice(66, 130)}`));
          const word = parseInt(r.returnData.slice(130, 132), 16);
          assert.equal(length, 1, "a rule returns one byte");
          assert.equal(word, c.table[base + i], `${c.rule.name}, input ${base + i}`);
          checked++;
        });
      }
      assert.equal(checked, INPUT_SPACE);
    }
  });

  it("refuses the wrong payment", async () => {
    const netlist = bytesToHex(encodeNetlist(compiled[0]!.netlist));
    for (const value of [0n, TAPEOUT_FEE, TAPEOUT_FEE + RULE_FEE - 1n, TAPEOUT_FEE + RULE_FEE + 1n]) {
      assert.match(await revertOf(stock.simulate.tapeOut([netlist, ""], { value, account: buyer.account })), /WrongValue/);
    }
  });

  it("refuses anything that is not a flat, rule-sized NAND netlist", async () => {
    const value = TAPEOUT_FEE + RULE_FEE;
    const attempt = (netlist: Hex, label = "") => revertOf(stock.simulate.tapeOut([netlist, label], { value, account: buyer.account }));
    const good = bytesToHex(encodeNetlist(compiled[0]!.netlist));
    assert.match(await attempt("0x"), /EmptyNetlist/);
    assert.match(await attempt(`${good}00` as Hex), /NotWholeRecords/);
    // A LATCH or REF opcode at the start of a record.
    assert.match(await attempt(`0x01${good.slice(4)}` as Hex), /NotNandOnly/);
    assert.match(await attempt(`${good.slice(0, 2 + 14)}02${good.slice(2 + 16)}` as Hex), /NotNandOnly/);
    // 1,501 gates: one over the cap.
    assert.match(await attempt(`0x${"00000002000003".repeat(1501)}` as Hex), /TooManyGates/);
    assert.match(await attempt(good, "x".repeat(65)), /LabelTooLong/);
    // Too few gates for five outputs: rejected by TapeOut itself, and the whole call reverts.
    assert.notEqual(await attempt("0x00000002000003"), "");
    // A NAND reading a later signal: rejected by TapeOut itself.
    assert.notEqual(await attempt(`0x${"00000002ffffff".repeat(5)}` as Hex), "");
  });

  it("accepts the largest allowed rule and bounds what its eval costs", async () => {
    // 1,500 gates in a chain, so every gate is live.
    let records = "00000002000003";
    for (let i = 1; i < 1500; i++) records += `00${(13 + i - 1).toString(16).padStart(6, "0")}${(2 + (i % 11)).toString(16).padStart(6, "0")}`;
    const netlist = `0x${records}` as Hex;
    const { result: id } = await stock.simulate.tapeOut([netlist, "largest"], { value: TAPEOUT_FEE + RULE_FEE, account: stranger.account });
    const receipt = await fork.mined(await stock.write.tapeOut([netlist, "largest"], { value: TAPEOUT_FEE + RULE_FEE, account: stranger.account }));
    const evalGas = await fork.pub.estimateGas({ account: stranger.account.address, to: circuits, data: encodeFunctionData({ abi: tapeoutAbi, functionName: "eval", args: [id, "0xff07"] }) });
    console.log(`      1,500-gate rule: tape-out ${receipt.gasUsed} gas, eval ${evalGas} gas`);
    assert.ok(receipt.gasUsed < 6_000_000n);
    assert.ok(evalGas < 4_000_000n);
  });

  it("sends the accrued fees to the fee address, whoever calls", async () => {
    const accrued = await stock.read.feesAccrued();
    assert.equal(accrued, RULE_FEE * 5n);
    const before = await fork.pub.getBalance({ address: feeRecipient.account.address });
    await fork.mined(await stock.write.withdrawFees({ account: stranger.account }));
    assert.equal((await fork.pub.getBalance({ address: feeRecipient.account.address })) - before, accrued);
    assert.equal(await stock.read.feesAccrued(), 0n);
    assert.equal(await fork.pub.getBalance({ address: stock.address }), 0n);
    assert.match(await revertOf(stock.simulate.withdrawFees({ account: stranger.account })), /NothingToWithdraw/);
  });

  it("would cost more than 80 OKB in TapeOut fees alone to drain", async () => {
    const remaining: bigint = await stock.read.stockRemaining();
    const tapeOutsToDrain = remaining / 1500n;
    const cost = tapeOutsToDrain * TAPEOUT_FEE;
    console.log(`      ${remaining} transistors left; draining needs ${tapeOutsToDrain} maximum-size tape-outs = ${Number(cost) / 1e18} OKB in TapeOut fees, plus ${Number(tapeOutsToDrain * RULE_FEE) / 1e18} OKB in rule fees`);
    assert.ok(cost > parseEther("80"));
  });

  it("reports the cost of opening", () => {
    console.log(`      open(): ${openGas} gas`);
  });
});
