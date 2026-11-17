// The whole mainnet deployment as one function, so the exact same steps run on the fork (a rehearsal that
// costs nothing) and on X Layer. Every step is checked before it is sent, recorded in a ledger with its
// gas and fees, and skipped on a re-run if the chain already shows it done.
import fs from "node:fs";
import { bytesToHex, encodeFunctionData, getAddress, parseAbi, type Abi, type Address, type Hash, type Hex, type PublicClient, type WalletClient } from "viem";
import { INPUT_SPACE, MULTICALL3, STARTER_RULES, TAPEOUT, compileRule, encodeNetlist, inputToBytes, truthTable } from "@gavelock/core";

export interface DeployParams {
  /// Receives the tender fee and the rule fees.
  feeRecipient: Address;
  /// OKB per custom rule, on top of TapeOut's own tape-out fee.
  ruleFee: bigint;
  /// OKB per full tender. A Quick Quote is free.
  tenderFee: bigint;
  supply: bigint;
  /// Starter rules to tape out now, by key. Others can be added later with scripts/add-rules.ts.
  rules: readonly string[];
  name: string;
  symbol: string;
  story: string;
}

export interface LedgerRow {
  step: string;
  hash: Hash;
  gas: bigint;
  /// OKB sent with the call, in wei.
  valueWei: bigint;
  /// Fee token pulled by the call, in its smallest unit (8 decimals).
  bemUnits: bigint;
  gasPriceWei: bigint;
}

export interface State {
  stock?: Address;
  engine?: Address;
  gavelock?: Address;
  panel?: Address;
  records?: Address;
  processor?: Address;
  transistors?: Address;
  opened?: boolean;
  /** starter rule key -> circuit id */
  rules?: Record<string, number>;
  ledger: LedgerRow[];
}

export interface Context {
  pub: PublicClient;
  wallet: WalletClient;
  account: Address;
  artifactsDir: URL;
  log: (line: string) => void;
  save: (state: State) => void;
}

const feeAbi = parseAbi([
  "function bem() view returns (address)",
  "function deployFee() view returns (uint256)",
  "function protocolFee() view returns (uint256)",
  "function isSealed() view returns (bool)",
  "function owner() view returns (address)",
  "function cpuCount() view returns (uint256)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address spender, uint256 value) returns (bool)", "function allowance(address owner, address spender) view returns (uint256)", "function decimals() view returns (uint8)"]);
const circuitsAbi = parseAbi(["function TAPEOUT_FEE() view returns (uint256)", "function eval(uint256 id, bytes inputs) view returns (bytes)", "function circuitInfo(uint256) view returns (uint32, uint32, uint32, uint32)"]);
const mcAbi = parseAbi(["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])"]);

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
  linkReferences: Record<string, Record<string, { start: number; length: number }[]>>;
}

export function loadArtifact(dir: URL, name: string): Artifact {
  return JSON.parse(fs.readFileSync(new URL(`contracts/${name}.sol/${name}.json`, dir), "utf8"));
}

/** Put a library's address into the placeholder positions of a contract's creation code. */
export function link(artifact: Artifact, library: string, address: Address): Hex {
  let code = artifact.bytecode.slice(2);
  const refs = Object.values(artifact.linkReferences).flatMap((byName) => byName[library] ?? []);
  if (refs.length === 0) throw new Error(`no link reference for ${library}`);
  for (const { start, length } of refs) {
    if (length !== 20) throw new Error("unexpected link reference length");
    code = code.slice(0, start * 2) + address.slice(2).toLowerCase() + code.slice(start * 2 + 40);
  }
  if (code.includes("__$")) throw new Error("unlinked library placeholder left in the bytecode");
  return `0x${code}`;
}

export interface Preflight {
  chainId: number;
  bem: Address;
  deployFee: bigint;
  mintFee: bigint;
  tapeoutFee: bigint;
  factorySealed: boolean;
  factoryOwner: Address;
  balanceOkb: bigint;
  balanceBem: bigint;
  /** BEM the whole deployment pulls. */
  bemNeeded: bigint;
  /** OKB the fees alone cost (rule tape-outs, rule fees), before gas. */
  okbFeesNeeded: bigint;
}

/** Everything about the live chain a human should see before approving. Sends nothing. */
export async function preflight(ctx: Context, params: DeployParams): Promise<Preflight> {
  const { pub, account } = ctx;
  const [chainId, bem, deployFee, mintFee, sealed, owner, balanceOkb] = await Promise.all([
    pub.getChainId(),
    pub.readContract({ address: TAPEOUT.factory, abi: feeAbi, functionName: "bem" }),
    pub.readContract({ address: TAPEOUT.factory, abi: feeAbi, functionName: "deployFee" }),
    pub.readContract({ address: TAPEOUT.factory, abi: feeAbi, functionName: "protocolFee" }),
    pub.readContract({ address: TAPEOUT.factory, abi: feeAbi, functionName: "isSealed" }),
    pub.readContract({ address: TAPEOUT.factory, abi: feeAbi, functionName: "owner" }),
    pub.getBalance({ address: account }),
  ]);
  const balanceBem = await pub.readContract({ address: bem, abi: erc20, functionName: "balanceOf", args: [account] });
  // The tape-out fee is a constant of the circuits implementation: read it from a live processor.
  const live = await pub.readContract({ address: TAPEOUT.factory, abi: parseAbi(["function cpuAt(uint256) view returns (address)"]), functionName: "cpuAt", args: [0n] });
  const tapeoutFee = await pub.readContract({ address: live, abi: circuitsAbi, functionName: "TAPEOUT_FEE" });
  const rules = BigInt(STARTER_RULES.filter((r) => params.rules.includes(r.key)).length);
  return { chainId, bem, deployFee, mintFee, tapeoutFee, factorySealed: sealed, factoryOwner: owner, balanceOkb, balanceBem, bemNeeded: deployFee + mintFee, okbFeesNeeded: rules * (tapeoutFee + params.ruleFee) };
}

export async function deployAll(ctx: Context, params: DeployParams, state: State): Promise<State> {
  const { pub, wallet, account, log } = ctx;
  const send = async (step: string, request: () => Promise<Hash>, valueWei = 0n, bemUnits = 0n) => {
    const hash = await request();
    const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${step}: transaction ${hash} reverted`);
    state.ledger.push({ step, hash, gas: receipt.gasUsed, valueWei, bemUnits, gasPriceWei: receipt.effectiveGasPrice });
    ctx.save(state);
    log(`${step}: ${receipt.gasUsed} gas  ${hash}`);
    return receipt;
  };
  const deploy = async (step: string, artifact: Artifact, bytecode: Hex, args: unknown[]) => {
    const hash = await wallet.deployContract({ abi: artifact.abi, bytecode, args, account, chain: undefined } as never);
    const receipt = await send(step, async () => hash);
    if (!receipt.contractAddress) throw new Error(`${step}: no contract address`);
    return getAddress(receipt.contractAddress);
  };

  const pf = await preflight(ctx, params);
  if (pf.balanceBem < pf.bemNeeded) throw new Error(`the deploy wallet holds ${pf.balanceBem} BEM units, the deployment needs ${pf.bemNeeded}`);

  // 1. The rule stock.
  const stockArt = loadArtifact(ctx.artifactsDir, "RuleStock");
  if (!state.stock) state.stock = await deploy("deploy RuleStock", stockArt, stockArt.bytecode, [TAPEOUT.factory, params.feeRecipient, params.ruleFee, params.supply, params.name, params.symbol, params.story]);
  ctx.save(state);

  // 2. Approve the fee token for the stock, then create the processor and mint the whole supply, in one transaction.
  const read = <T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) => pub.readContract({ address, abi, functionName, args } as never) as Promise<T>;
  if (!state.opened) {
    const existing = await read<Address>(state.stock, stockArt.abi, "circuits");
    if (/^0x0+$/.test(existing)) {
      await send("approve the fee token for the stock", () => wallet.writeContract({ address: pf.bem, abi: erc20, functionName: "approve", args: [state.stock!, pf.bemNeeded], account, chain: undefined } as never));
      await send("open the stock: create the processor and mint the whole supply", () => wallet.writeContract({ address: state.stock!, abi: stockArt.abi, functionName: "open", account, chain: undefined } as never), 0n, pf.bemNeeded);
    }
    state.processor = await read<Address>(state.stock, stockArt.abi, "circuits");
    state.transistors = await read<Address>(state.stock, stockArt.abi, "transistors");
    state.opened = true;
    ctx.save(state);
  }

  // 3. The four starter rules, each compiled from its definition and proven equal to its table before it is sent.
  state.rules ??= {};
  for (const rule of STARTER_RULES.filter((r) => params.rules.includes(r.key))) {
    if (state.rules[rule.key] !== undefined) continue;
    const table = truthTable(rule.spec);
    const compiled = compileRule(table);
    const price = pf.tapeoutFee + params.ruleFee;
    const netlist = bytesToHex(encodeNetlist(compiled.netlist));
    const { result } = await pub.simulateContract({ address: state.stock, abi: stockArt.abi, functionName: "tapeOut", args: [netlist, rule.name], value: price, account } as never);
    await send(`tape out "${rule.name}" (${compiled.gates} NAND)`, () => wallet.writeContract({ address: state.stock!, abi: stockArt.abi, functionName: "tapeOut", args: [netlist, rule.name], value: price, account, chain: undefined } as never), price);
    state.rules[rule.key] = Number(result);
    ctx.save(state);
  }

  // 4. The award library, then the tender contract linked to it.
  const engineArt = loadArtifact(ctx.artifactsDir, "AwardEngine");
  if (!state.engine) state.engine = await deploy("deploy AwardEngine", engineArt, engineArt.bytecode, []);
  const gavelockArt = loadArtifact(ctx.artifactsDir, "Gavelock");
  if (!state.gavelock) state.gavelock = await deploy("deploy Gavelock (with its panel and records contracts)", gavelockArt, link(gavelockArt, "AwardEngine", state.engine), [state.stock, params.feeRecipient, params.tenderFee]);
  state.panel = await read<Address>(state.gavelock, gavelockArt.abi, "panel");
  state.records = await read<Address>(state.gavelock, gavelockArt.abi, "records");
  ctx.save(state);
  return state;
}

export interface Verification {
  check: string;
  ok: boolean;
  detail: string;
}

/** After deployment: everything claimed about the system, read back from the chain. */
export async function verifyDeployment(ctx: Context, params: DeployParams, state: State): Promise<Verification[]> {
  const { pub } = ctx;
  const out: Verification[] = [];
  const add = (check: string, ok: boolean, detail = "") => out.push({ check, ok, detail });
  const stockArt = loadArtifact(ctx.artifactsDir, "RuleStock");
  const gavelockArt = loadArtifact(ctx.artifactsDir, "Gavelock");
  const read = <T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) => pub.readContract({ address, abi, functionName, args } as never) as Promise<T>;
  const sizeOf = async (a: Address) => ((await pub.getCode({ address: a }))!.length - 2) / 2;

  const transistors = state.transistors!;
  const tAbi = parseAbi(["function supplyCap() view returns (uint256)", "function minted() view returns (uint256)", "function mintPrice() view returns (uint256)", "function balanceOf(address,uint256) view returns (uint256)"]);
  const burned = BigInt(
    STARTER_RULES.filter((r) => state.rules![r.key] !== undefined).reduce((n, r) => n + compileRule(truthTable(r.spec)).gates, 0),
  );
  add("the processor is registered with the TapeOut factory", await read<boolean>(TAPEOUT.factory, parseAbi(["function isCPU(address) view returns (bool)"]) as Abi, "isCPU", [state.processor!]));
  add("the supply cap equals the supply", (await read<bigint>(transistors, tAbi as Abi, "supplyCap")) === params.supply);
  add("the whole supply was minted (nobody can mint more)", (await read<bigint>(transistors, tAbi as Abi, "minted")) === params.supply);
  add("the mint price is 0", (await read<bigint>(transistors, tAbi as Abi, "mintPrice")) === 0n);
  const left = await read<bigint>(transistors, tAbi as Abi, "balanceOf", [state.stock!, 0n]);
  add("the stock holds the supply minus the gates burned by the starter rules", left === params.supply - burned, `${left} of ${params.supply}`);
  add("the fee recipient is set", getAddress(await read<Address>(state.stock!, stockArt.abi, "feeRecipient")) === getAddress(params.feeRecipient));
  add("the rule fee is set", (await read<bigint>(state.stock!, stockArt.abi, "ruleFee")) === params.ruleFee);
  add("the tender fee is set", (await read<bigint>(state.gavelock!, gavelockArt.abi, "tenderFee")) === params.tenderFee);
  add("the tender contract reads the stock's processor", getAddress(await read<Address>(state.gavelock!, gavelockArt.abi, "circuits")) === getAddress(state.processor!));
  add("the tender contract points at this stock", getAddress(await read<Address>(state.gavelock!, gavelockArt.abi, "ruleStock")) === getAddress(state.stock!));
  for (const [label, address] of [["Gavelock", state.gavelock!], ["TenderPanel", state.panel!], ["TenderRecords", state.records!], ["RuleStock", state.stock!], ["AwardEngine", state.engine!]] as const) {
    const size = await sizeOf(address);
    add(`${label} is under the code size limit`, size > 0 && size <= 24_576, `${size} bytes`);
  }
  for (const name of ["owner", "transferOwnership", "upgradeTo", "upgradeToAndCall", "pause", "setFee"]) {
    add(`Gavelock has no ${name}()`, !(gavelockArt.abi as unknown as { name?: string }[]).some((f) => f.name === name));
  }

  // Every starter rule: all 2,048 outputs from the chain equal the truth table made from its definition.
  for (const rule of STARTER_RULES.filter((r) => state.rules![r.key] !== undefined)) {
    const id = state.rules![rule.key]!;
    const table = truthTable(rule.spec);
    let bad = 0;
    for (let base = 0; base < INPUT_SPACE; base += 128) {
      const calls = Array.from({ length: 128 }, (_, i) => ({ target: state.processor!, allowFailure: true, callData: encodeFunctionData({ abi: circuitsAbi, functionName: "eval", args: [BigInt(id), bytesToHex(inputToBytes(base + i))] }) }));
      const results = (await pub.readContract({ address: MULTICALL3, abi: mcAbi, functionName: "aggregate3", args: [calls], gas: 150_000_000n } as never)) as { success: boolean; returnData: Hex }[];
      results.forEach((r, i) => {
        const okShape = r.success && r.returnData.length >= 132 && BigInt(`0x${r.returnData.slice(66, 130)}`) === 1n;
        if (!okShape || parseInt(r.returnData.slice(130, 132), 16) !== table[base + i]) bad++;
      });
    }
    add(`rule "${rule.name}" (circuit ${id}) matches its definition on all ${INPUT_SPACE} inputs`, bad === 0, bad ? `${bad} differ` : "");
  }
  return out;
}
