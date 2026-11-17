// DeWEB dry run on the fork: publish the real web build on chain exactly as it would be on mainnet, read it
// back, verify every hash, and report the size and the cost. Spends nothing (a fork).
//   npx hardhat run scripts/deweb-dry.ts --network xlayerFork
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { formatEther, parseAbi, toHex, type Address, type Hex } from "viem";
import { TAPEOUT } from "@gavelock/core";
import { deployAll, preflight, type Context, type DeployParams, type State } from "../deploy/plan.ts";
import { profileFromEnv } from "../deploy/profiles.ts";

const CHUNK = 24_000;
const AREA = 2; // X Layer's chain code in TapeOut names
const dist = new URL("../../../web/dist/", import.meta.url);

const abi = parseAbi([
  "function FEE() view returns (uint256)",
  "function open(address circuits, uint256 tokenId) payable",
  "function accountOf(address circuits, uint256 tokenId) view returns (address)",
  "function isOpened(address circuits, uint256 tokenId) view returns (bool)",
  "function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)",
  "function putFile(address container, string path, string contentType, bytes32 sha256Hash, bytes data)",
  "function appendChunk(address container, string path, uint256 expectIndex, bytes data)",
  "function read(address container, string path) view returns (bytes)",
  "function readRange(address container, string path, uint256 offset, uint256 len) view returns (bytes)",
  "function monthlyFee() view returns (uint256)",
  "function isLive(string name, address container) view returns (bool)",
  "function isContainerLive(address container) view returns (bool)",
  "function bind(string name, address container, uint256 months) payable",
  "function cpuCount() view returns (uint256)",
]);
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };

function listFiles(dir: string, base = ""): string[] {
  return fs.readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(dir, path.posix.join(base, e.name)) : [path.posix.join(base, e.name)]));
}

const connection = await network.create({ network: "xlayerFork", chainType: "op" });
const { viem } = connection;
const pub = await viem.getPublicClient();
const test = await viem.getTestClient();
const [deployer, recipient] = await viem.getWalletClients();
const { name: profileName, profile } = profileFromEnv();
const params: DeployParams = { ruleFee: profile.ruleFee, tenderFee: profile.tenderFee, supply: profile.supply, name: profile.name, symbol: profile.symbol, story: profile.story, rules: profile.rules, feeRecipient: recipient!.account.address };
console.log(`profile: ${profileName} (${profile.rules.length} rule(s))`);

// Fork only: the fee token the real wallet must hold.
const HOLDER: Address = "0x571d447f4f24688eC35Ccf07f1D6993655F6aF15";
await test.impersonateAccount({ address: HOLDER });
await test.setBalance({ address: HOLDER, value: 10n ** 18n });
const holder = await viem.getWalletClient(HOLDER);
await pub.waitForTransactionReceipt({ hash: await holder.writeContract({ address: TAPEOUT.bem, abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [deployer!.account.address, 12_000_000n] }) });
await test.stopImpersonatingAccount({ address: HOLDER });
await test.setBalance({ address: deployer!.account.address, value: 10n ** 18n });

const state: State = { ledger: [] };
const ctx: Context = { pub: pub as never, wallet: deployer as never, account: deployer!.account.address, artifactsDir: new URL("../artifacts/", import.meta.url), log: () => {}, save: () => {} };
const processorsBefore = await pub.readContract({ address: TAPEOUT.factory, abi, functionName: "cpuCount" });
await preflight(ctx, params);
await deployAll(ctx, params, state);
const processor = state.processor!;
const circuitId = BigInt(Object.values(state.rules!)[0]!); // the deploy wallet owns the starter rules it taped out
const name = `${circuitId}.${AREA}.${processorsBefore}.tape`;

const rows: { step: string; gas: bigint; okb: bigint }[] = [];
const send = async (step: string, to: Address, data: Hex, value = 0n) => {
  const hash = await deployer!.sendTransaction({ to, data, value, gas: 30_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${step} reverted`);
  rows.push({ step, gas: rc.gasUsed, okb: value });
  return rc;
};
const { encodeFunctionData } = await import("viem");
const call = (functionName: string, args: unknown[]) => encodeFunctionData({ abi, functionName, args } as never);

const openFee = await pub.readContract({ address: TAPEOUT.opener, abi, functionName: "FEE" });
await send("open the site container (circuit #1's account)", TAPEOUT.opener, call("open", [processor, circuitId]), openFee);
const container = await pub.readContract({ address: TAPEOUT.opener, abi, functionName: "accountOf", args: [processor, circuitId] });

const root = fileURLToPath(dist);
const files = listFiles(root).sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));
let totalBytes = 0;
const manifest: { path: string; bytes: number; chunks: number; sha256: string }[] = [];
for (const file of files) {
  const bytes = fs.readFileSync(path.join(root, file));
  const sha = `0x${crypto.createHash("sha256").update(bytes).digest("hex")}` as Hex;
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
  totalBytes += bytes.length;
  manifest.push({ path: file, bytes: bytes.length, chunks, sha256: sha });
  const type = TYPES[path.extname(file)] ?? "application/octet-stream";
  await send(`putFile ${file}`, TAPEOUT.siteRegistry, call("putFile", [container, file, type, sha, toHex(bytes.subarray(0, CHUNK))]));
  for (let i = 1; i < chunks; i++) await send(`appendChunk ${file} #${i}`, TAPEOUT.siteRegistry, call("appendChunk", [container, file, BigInt(i), toHex(bytes.subarray(i * CHUNK, (i + 1) * CHUNK))]));
}
const monthly = await pub.readContract({ address: TAPEOUT.domainBinding, abi, functionName: "monthlyFee" });
const months = monthly === 0n ? 120n : 1n;
await send(`bind ${name}`, TAPEOUT.domainBinding, call("bind", [name, container, months]), months * monthly);

// Read everything back the way a gateway does and check every hash.
let verified = 0;
for (const m of manifest) {
  const [size, , hash, , chunkCount] = await pub.readContract({ address: TAPEOUT.siteRegistry, abi, functionName: "fileInfo", args: [container, m.path] });
  let data = new Uint8Array(0);
  const parts: Uint8Array[] = [];
  for (let off = 0; off < size; off += 96 * 1024) parts.push(Buffer.from((await pub.readContract({ address: TAPEOUT.siteRegistry, abi, functionName: "readRange", args: [container, m.path, BigInt(off), BigInt(Math.min(96 * 1024, size - off))] })).slice(2), "hex"));
  data = Buffer.concat(parts);
  const ok = hash === m.sha256 && data.length === m.bytes && `0x${crypto.createHash("sha256").update(data).digest("hex")}` === m.sha256 && Number(chunkCount) === m.chunks;
  if (!ok) throw new Error(`${m.path}: read-back does not match`);
  verified++;
}
const live = await pub.readContract({ address: TAPEOUT.domainBinding, abi, functionName: "isLive", args: [name, container] });

const gasPrice = 20_000_001n;
const totalGas = rows.reduce((a, r) => a + r.gas, 0n);
const fees = rows.reduce((a, r) => a + r.okb, 0n);
console.table(rows.map((r) => ({ step: r.step, gas: r.gas.toString(), okbFee: formatEther(r.okb) })));
console.log(`files ${files.length}, ${totalBytes} bytes, ${rows.length} transactions`);
console.log(`name ${name} live: ${live}; ${verified}/${files.length} files read back and verified`);
console.log(`TOTAL gas ${totalGas} = ${formatEther(totalGas * gasPrice)} OKB, plus fees ${formatEther(fees)} OKB`);
fs.mkdirSync(new URL("../reports/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../reports/deweb-dry-run.json", import.meta.url), JSON.stringify({ forkBlock: 76_155_264, name, container, files: manifest, bytes: totalBytes, transactions: rows.length, gas: totalGas, feesWei: fees, openFeeWei: openFee, nameLive: live, readBackVerified: verified }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
await connection.close();
