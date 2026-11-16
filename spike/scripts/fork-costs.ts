// Cost measurement on an in-process fork of X Layer mainnet, against the real TapeOut contracts.
// Uses Hardhat's simulated network only; nothing is broadcast.
//   npx hardhat run scripts/fork-costs.ts --network xlayerFork
import fs from "node:fs";
import { network } from "hardhat";
import { parseAbi, decodeEventLog, encodeFunctionData, formatEther, keccak256, toHex, type Hex } from "viem";
// @ts-ignore plain JS module shared with the local sizing script
import { RULES, truthTable, randomTable, compileBest, equivalent, encode, packInput } from "./lib/rules.mjs";

const FACTORY = "0x1f09daefa827f02cbb40967cc91b259763760761" as const;
const OPENER = "0x536add8f30f03b69f6fbf29d425a816a0dc50106" as const;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const MAINNET_GAS_PRICE = 20_000_001n; // wei, read from rpc.xlayer.tech on 2026-11-16

const abi = parseAbi([
  "function deployFee() view returns (uint256)",
  "function protocolFee() view returns (uint256)",
  "function cpuCount() view returns (uint256)",
  "function cpuAt(uint256) view returns (address)",
  "function isCPU(address) view returns (bool)",
  "function createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address, address)",
  "event CPUCreated(address indexed circuits, address indexed transistors, address indexed creator, string name, uint256 supply, uint256 mintPrice)",
  "function mint(uint256 id, uint256 amount) payable",
  "function mintPrice() view returns (uint256)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function TAPEOUT_FEE() view returns (uint256)",
  "function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)",
  "event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)",
  "function circuitInfo(uint256) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)",
  "function netlist(uint256) view returns (bytes)",
  "function eval(uint256 id, bytes inputs) view returns (bytes)",
  "function nextId() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function FEE() view returns (uint256)",
  "function open(address circuits, uint256 tokenId) payable",
  "function accountOf(address circuits, uint256 tokenId) view returns (address)",
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
]);

const erc20 = parseAbi([
  "function bem() view returns (address)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

const connection = await network.create({ network: "xlayerFork", chainType: "op" });
const { viem } = connection;
const pub = await viem.getPublicClient();
const [deployer, buyer, bidderA, bidderB, bidderC] = await viem.getWalletClients();
const forkBlock = await pub.getBlockNumber();
const rows: { step: string; gas: bigint; value: bigint; bem: bigint; note?: string }[] = [];
const out: Record<string, unknown> = { forkBlock: Number(forkBlock), chainId: await pub.getChainId(), mainnetGasPriceWei: MAINNET_GAS_PRICE.toString() };
console.log(`fork of chain ${out.chainId} at block ${forkBlock}`);

const reason = (e: any) => String(e?.shortMessage ?? e?.details ?? e?.message ?? e).split("\n")[0].slice(0, 200);
async function send(step: string, wallet: typeof deployer, to: Hex, data: Hex, value = 0n, note?: string, bem = 0n) {
  const hash = await wallet.sendTransaction({ to, data, value, gas: 150_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${step} reverted`);
  rows.push({ step, gas: rc.gasUsed, value, bem, note });
  console.log(`${step}: ${rc.gasUsed} gas, value ${formatEther(value)} OKB${note ? ` (${note})` : ""}`);
  return rc;
}
const tryCall = async (label: string, fn: () => Promise<unknown>) => { try { const v = await fn(); console.log(`${label}: ok`); return { ok: true, v }; } catch (e) { console.log(`${label}: ${reason(e)}`); return { ok: false, v: reason(e) }; } };

// ---------------------------------------------------------------- 1. processor
const deployFee = await pub.readContract({ address: FACTORY, abi, functionName: "deployFee" });
const cpuCountBefore = await pub.readContract({ address: FACTORY, abi, functionName: "cpuCount" });
const STORY = "Gavelock: tamper-proof tenders. Every scoring rule is a circuit taped out here; awards are computed by calling it.";
const SUPPLY = 100_000_000n;
const createArgs = ["Gavelock", "GAVEL", STORY, SUPPLY, 0n] as const;
// Since the factory upgrade of early November 2026 the processor fee is charged in the BEM token
// (ERC-20, 8 decimals) through an allowance, and createCPU no longer accepts OKB.
const BEM = await pub.readContract({ address: FACTORY, abi: erc20, functionName: "bem" });
const bemDecimals = await pub.readContract({ address: BEM, abi: erc20, functionName: "decimals" });
out.bem = { token: BEM, decimals: bemDecimals, deployFeeUnits: deployFee.toString() };
out.createWithoutAllowance = (await tryCall("createCPU with no BEM allowance", () => pub.simulateContract({ account: deployer.account, address: FACTORY, abi, functionName: "createCPU", args: createArgs, value: 0n }))).v;
out.createWithOkbValue = (await tryCall("createCPU paying 0.0066 OKB instead", () => pub.simulateContract({ account: deployer.account, address: FACTORY, abi, functionName: "createCPU", args: createArgs, value: 6_600_000_000_000_000n }))).v;
// Fork only: take the fee amount from an existing holder. On mainnet the deploy wallet must hold it.
const HOLDER = "0x571d447f4f24688eC35Ccf07f1D6993655F6aF15" as const;
const test = await viem.getTestClient();
await test.impersonateAccount({ address: HOLDER });
await test.setBalance({ address: HOLDER, value: 10n ** 18n });
const holder = await viem.getWalletClient(HOLDER);
await pub.waitForTransactionReceipt({ hash: await holder.writeContract({ address: BEM, abi: erc20, functionName: "transfer", args: [deployer.account.address, deployFee * 3n] }) });
await test.stopImpersonatingAccount({ address: HOLDER });
await send(`approve ${deployFee} BEM units for the factory`, deployer, BEM, encodeFunctionData({ abi: erc20, functionName: "approve", args: [FACTORY, deployFee] }));
const rcCreate = await send("createCPU (Gavelock processor), fee 0.1 BEM", deployer, FACTORY, encodeFunctionData({ abi, functionName: "createCPU", args: createArgs }), 0n, undefined, deployFee);
out.bemLeftAfterCreate = (await pub.readContract({ address: BEM, abi: erc20, functionName: "balanceOf", args: [deployer.account.address] })).toString();
const created = rcCreate.logs.map((l) => { try { return decodeEventLog({ abi, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === "CPUCreated") as any;
const circuits = created.args.circuits as Hex;
const transistors = created.args.transistors as Hex;
const cpuNumber = cpuCountBefore;
out.processor = { circuits, transistors, number: Number(cpuNumber), isCPU: await pub.readContract({ address: FACTORY, abi, functionName: "isCPU", args: [circuits] }) };
console.log(`processor #${cpuNumber}: circuits ${circuits}, transistors ${transistors}`);
const mintFee = await pub.readContract({ address: transistors, abi, functionName: "protocolFee" });
const tapeoutFee = await pub.readContract({ address: circuits, abi, functionName: "TAPEOUT_FEE" });
out.fees = { deployFee: deployFee.toString(), mintProtocolFee: mintFee.toString(), tapeoutFee: tapeoutFee.toString(), openFee: (await pub.readContract({ address: OPENER, abi, functionName: "FEE" })).toString() };

// ---------------------------------------------------------------- 2. rules
const compiled = Object.entries(RULES as Record<string, { name: string; fn: (f: any) => number }>).map(([key, r]) => {
  const table = truthTable(r.fn) as Uint8Array;
  const c = compileBest(table);
  if (!equivalent(c, table).ok) throw new Error(`${key}: local equivalence failed`);
  return { key, name: r.name, table, c };
});
{ const table = randomTable(7) as Uint8Array; compiled.push({ key: "random", name: "Worst case: random table", table, c: compileBest(table) }); }
const starterGates = compiled.slice(0, 4).reduce((s, r) => s + r.c.gates.length, 0);
const allGates = compiled.reduce((s, r) => s + r.c.gates.length, 0);

// Processors created after the upgrade charge the per-call mint fee in BEM too (0.01 BEM),
// through an allowance to the transistors contract; mint no longer accepts OKB.
out.mintWithOkbValue = (await tryCall("mint paying OKB instead of BEM", () => pub.simulateContract({ account: deployer.account, address: transistors, abi, functionName: "mint", args: [0n, 10n], value: mintFee }))).v;
out.mintWithoutAllowance = (await tryCall("mint with no BEM allowance", () => pub.simulateContract({ account: deployer.account, address: transistors, abi, functionName: "mint", args: [0n, 10n] }))).v;
await send("approve BEM for the transistors contract", deployer, BEM, encodeFunctionData({ abi: erc20, functionName: "approve", args: [transistors, mintFee * 2n] }));
// One mint call covers the four starter rules; a second covers the sizing extras.
await send(`mint ${starterGates} NAND (4 starter rules), fee 0.01 BEM`, deployer, transistors, encodeFunctionData({ abi, functionName: "mint", args: [0n, BigInt(starterGates)] }), 0n, undefined, mintFee);
await send(`mint ${allGates - starterGates} NAND (sizing extras, not part of the plan)`, deployer, transistors, encodeFunctionData({ abi, functionName: "mint", args: [0n, BigInt(allGates - starterGates)] }), 0n, "extra", mintFee);
out.bemLeftAfterMints = (await pub.readContract({ address: BEM, abi: erc20, functionName: "balanceOf", args: [deployer.account.address] })).toString();

out.tapeoutWrongFee = (await tryCall("tapeout with fee + 1 wei", () => pub.simulateContract({ account: deployer.account, address: circuits, abi, functionName: "tapeout", args: [encode(compiled[0].c), 11, 5], value: tapeoutFee + 1n }))).v;
out.tapeoutNoTransistors = (await tryCall("tapeout from a wallet with no transistors", () => pub.simulateContract({ account: buyer.account, address: circuits, abi, functionName: "tapeout", args: [encode(compiled[0].c), 11, 5], value: tapeoutFee }))).v;

const ruleOut: any[] = [];
for (const r of compiled) {
  const extra = compiled.indexOf(r) >= 4;
  const rc = await send(`tapeout "${r.name}" (${r.c.gates.length} NAND)`, deployer, circuits, encodeFunctionData({ abi, functionName: "tapeout", args: [encode(r.c), 11, 5] }), tapeoutFee, extra ? "extra" : undefined);
  const ev = rc.logs.map((l) => { try { return decodeEventLog({ abi, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === "TapedOut") as any;
  const id = ev.args.circuitId as bigint;
  const info = await pub.readContract({ address: circuits, abi, functionName: "circuitInfo", args: [id] });
  const stored = await pub.readContract({ address: circuits, abi, functionName: "netlist", args: [id] });
  // eval gas: execution only (estimate minus the 21,000 base and calldata)
  const samples = [0, 0x7ff, 0x155, 0x2aa, 0x120, 0x05f];
  let evalGasMax = 0n;
  for (const x of samples) {
    const g = await pub.estimateGas({ account: deployer.account, to: circuits, data: encodeFunctionData({ abi, functionName: "eval", args: [id, packInput(x)] }) });
    if (g > evalGasMax) evalGasMax = g;
  }
  // exhaustive on-chain check through Multicall3 (a contract calling eval), all 2,048 inputs
  const total = r.key === "random" ? 256 : 2048;
  const step = r.key === "random" ? 8 : 64;
  let mismatches = 0; let width = 0;
  for (let base = 0; base < total; base += step) {
    const calls = Array.from({ length: step }, (_, i) => ({ target: circuits, allowFailure: false, callData: encodeFunctionData({ abi, functionName: "eval", args: [id, packInput(base + i)] }) }));
    const res = await pub.readContract({ address: MULTICALL3, abi, functionName: "aggregate3", args: [calls], gas: 200_000_000n });
    res.forEach((x, i) => {
      // returnData is abi-encoded bytes: offset, length, data
      const len = Number(BigInt(`0x${x.returnData.slice(66, 130)}`));
      const word = parseInt(x.returnData.slice(130, 132), 16);
      width = len;
      if (len !== 1 || word !== r.table[base + i]) mismatches++;
    });
  }
  const row = { key: r.key, name: r.name, id: Number(id), gates: r.c.gates.length, circuitInfo: info.map(Number), netlistRoundTrip: stored === encode(r.c), tapeoutGas: rc.gasUsed.toString(), evalGasTxMax: evalGasMax.toString(), checkedInputs: total, mismatches, outputBytes: width };
  ruleOut.push(row);
  console.log(`  id ${id}, circuitInfo ${info.map(Number)}, eval <= ${evalGasMax} gas (as a transaction), on-chain check ${total - mismatches}/${total}, output ${width} byte(s)`);
}
out.rules = ruleOut;

// REF: a netlist made of a single reference to rule 2. Record: 02 | processor (20 bytes) | id (u64) | nIns | nOuts | ins (u24 each).
{
  const nandBefore = await pub.readContract({ address: transistors, abi, functionName: "balanceOf", args: [deployer.account.address, 0n] });
  const ins = Array.from({ length: 11 }, (_, i) => (2 + i).toString(16).padStart(6, "0")).join("");
  const refNetlist = `0x02${circuits.slice(2).toLowerCase()}${(2).toString(16).padStart(16, "0")}0b05${ins}` as Hex;
  const rc = await send("tapeout a circuit that is one REF to rule 2", deployer, circuits, encodeFunctionData({ abi, functionName: "tapeout", args: [refNetlist, 11, 5] }), tapeoutFee, "extra");
  const ev = rc.logs.map((l) => { try { return decodeEventLog({ abi, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === "TapedOut") as any;
  const id = ev.args.circuitId as bigint;
  const nandAfter = await pub.readContract({ address: transistors, abi, functionName: "balanceOf", args: [deployer.account.address, 0n] });
  let same = 0;
  for (let x = 0; x < 2048; x += 37) {
    const r = await pub.readContract({ address: circuits, abi, functionName: "eval", args: [id, packInput(x)] });
    if (parseInt(r.slice(2, 4), 16) === compiled[1].table[x]) same++;
  }
  const info = await pub.readContract({ address: circuits, abi, functionName: "circuitInfo", args: [id] });
  const evalGas = await pub.estimateGas({ account: deployer.account, to: circuits, data: encodeFunctionData({ abi, functionName: "eval", args: [id, packInput(0x155)] }) });
  out.ref = { id: Number(id), netlistBytes: (refNetlist.length - 2) / 2, nandBurned: (nandBefore - nandAfter).toString(), circuitInfo: info.map(Number), sampledInputsMatching: `${same}/56`, evalGasTx: evalGas.toString() };
  console.log("REF circuit:", out.ref);
  out.refBadPins = (await tryCall("REF with the wrong pin count", () => pub.simulateContract({ account: deployer.account, address: circuits, abi, functionName: "tapeout", args: [`0x02${circuits.slice(2).toLowerCase()}${(2).toString(16).padStart(16, "0")}0a05${ins.slice(0, 60)}` as Hex, 10, 5], value: tapeoutFee }))).v;
}

// ---------------------------------------------------------------- 3. a contract calling eval inside a transaction
const { contract: probe, deploymentTransaction } = await viem.sendDeploymentTransaction("EvalProbe", [circuits]);
const deployTx = await pub.waitForTransactionReceipt({ hash: deploymentTransaction.hash });
const probeCode = await pub.getCode({ address: probe.address });
rows.push({ step: `deploy EvalProbe (${(probeCode!.length - 2) / 2} bytes of runtime code)`, gas: deployTx.gasUsed, value: 0n, bem: 0n, note: "extra" });
console.log(`deploy EvalProbe: ${deployTx.gasUsed} gas for ${(probeCode!.length - 2) / 2} bytes`);
const probeAbi = probe.abi;
const rule2 = ruleOut[1];
const three = [0x0a0 | 0x300, 0x0a2 | 0x500, 0x0a5 | 0x700]; // three bids: mandatory met, different price and panel bands
const direct = await pub.readContract({ address: probe.address, abi: probeAbi, functionName: "score", args: [BigInt(rule2.id), three[0]] });
out.contractEval = { input: three[0], result: direct, expected: { eligible: (compiled[1].table[three[0]] & 1) === 1, score: compiled[1].table[three[0]] >> 1 } };
console.log(`probe.score(rule ${rule2.id}, ${three[0]}) = ${direct} (table says ${compiled[1].table[three[0]] & 1}, ${compiled[1].table[three[0]] >> 1})`);
await send(`contract scores 3 bids on rule "${rule2.name}" and stores results`, deployer, probe.address, encodeFunctionData({ abi: probeAbi, functionName: "scoreAndStore", args: [BigInt(rule2.id), three] }), 0n, "extra");
const stored0 = await pub.readContract({ address: probe.address, abi: probeAbi, functionName: "scoreOf", args: [0n] });
out.contractEvalStored = Number(stored0);
// Guarded call: too little gas must fail closed, not revert the caller.
out.guardedLowGas = await pub.readContract({ address: probe.address, abi: probeAbi, functionName: "scoreGuarded", args: [BigInt(rule2.id), three[0], 20_000n] });
out.guardedEnoughGas = await pub.readContract({ address: probe.address, abi: probeAbi, functionName: "scoreGuarded", args: [BigInt(rule2.id), three[0], 2_000_000n] });
out.guardedMissingCircuit = await pub.readContract({ address: probe.address, abi: probeAbi, functionName: "scoreGuarded", args: [999_999n, three[0], 2_000_000n] });
console.log("guarded eval: low gas", out.guardedLowGas, "enough gas", out.guardedEnoughGas, "missing circuit", out.guardedMissingCircuit);

// ---------------------------------------------------------------- 4. documents and sealed bids
const bytesOf = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 131 + 7) & 255 || 1; return toHex(b); };
for (const n of [2_000, 24_000, 100_000]) {
  await send(`publish a ${n.toLocaleString("en")}-byte document in an event (SHA-256 on chain)`, buyer, probe.address, encodeFunctionData({ abi: probeAbi, functionName: "publishDocument", args: [1n, bytesOf(n)] }), 0n, "extra");
}
for (const n of [400, 700, 1500]) {
  await send(`seal a bid: commitment + ${n}-byte ciphertext kept on chain + deposit`, bidderA, probe.address, encodeFunctionData({ abi: probeAbi, functionName: "sealBid", args: [keccak256(toHex(n)), bytesOf(n)] }), 10n ** 15n, "extra");
}
const back = await pub.readContract({ address: probe.address, abi: probeAbi, functionName: "ciphertextOf", args: [1n] });
out.ciphertextRoundTrip = back === bytesOf(700);
console.log("ciphertext read back from a view:", out.ciphertextRoundTrip);

// ---------------------------------------------------------------- 5. DeWEB container (Gate C input)
out.openSimulated = (await tryCall("opener.open for circuit #1 (simulated)", () => pub.simulateContract({ account: deployer.account, address: OPENER, abi, functionName: "open", args: [circuits, 1n], value: BigInt((out.fees as any).openFee) }))).ok;

// ---------------------------------------------------------------- report
const cost = (gas: bigint) => gas * MAINNET_GAS_PRICE;
out.rows = rows.map((r) => ({ step: r.step, gas: r.gas.toString(), valueWei: r.value.toString(), bemUnits: r.bem.toString(), gasCostWei: cost(r.gas).toString(), okbTotal: formatEther(r.value + cost(r.gas)), note: r.note ?? "" }));
console.log("\nstep | gas | fee (OKB) | fee (BEM) | gas cost (OKB)");
for (const r of rows) console.log(`${r.note === "extra" ? "  " : "* "}${r.step} | ${r.gas} | ${formatEther(r.value)} | ${Number(r.bem) / 1e8} | ${formatEther(cost(r.gas))}`);
fs.mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../out/fork-costs.json", import.meta.url), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
await connection.close();
void bidderB; void bidderC;
