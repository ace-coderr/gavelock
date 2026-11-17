// Rehearsal of the mainnet deployment on a fork of X Layer, using the exact code that runs on mainnet.
// Prints the ledger as the cost table the owner approves at Gate B. Spends nothing.
//   npx hardhat run scripts/rehearse.ts --network xlayerFork
import fs from "node:fs";
import { network } from "hardhat";
import { formatEther, parseEther, type Address } from "viem";
import { TAPEOUT } from "@gavelock/core";
import { deployAll, preflight, verifyDeployment, type Context, type DeployParams, type State } from "../deploy/plan.ts";
import { profileFromEnv } from "../deploy/profiles.ts";

const connection = await network.create({ network: "xlayerFork", chainType: "op" });
const { viem } = connection;
const pub = await viem.getPublicClient();
const test = await viem.getTestClient();
const [deployer, recipient] = await viem.getWalletClients();
const { name: profileName, profile } = profileFromEnv();
const params: DeployParams = { ruleFee: profile.ruleFee, tenderFee: profile.tenderFee, supply: profile.supply, name: profile.name, symbol: profile.symbol, story: profile.story, rules: profile.rules, feeRecipient: recipient!.account.address };
console.log(`profile: ${profileName} (${profile.rules.length} rule(s))`);

// Fork only: give the deployer what the real wallet must hold.
const pf0 = await preflight({ pub } as unknown as Context, params).catch(() => null);
const bem = pf0?.bem ?? TAPEOUT.bem;
const HOLDER: Address = "0x571d447f4f24688eC35Ccf07f1D6993655F6aF15";
await test.impersonateAccount({ address: HOLDER });
await test.setBalance({ address: HOLDER, value: 10n ** 18n });
const holder = await viem.getWalletClient(HOLDER);
const need = (pf0?.bemNeeded ?? 11_000_000n) + 1_000_000n;
await pub.waitForTransactionReceipt({ hash: await holder.writeContract({ address: bem, abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [deployer!.account.address, need] }) });
await test.stopImpersonatingAccount({ address: HOLDER });

const state: State = { ledger: [] };
const ctx: Context = { pub: pub as never, wallet: deployer as never, account: deployer!.account.address, artifactsDir: new URL("../artifacts/", import.meta.url), log: (l) => console.log(`  ${l}`), save: () => {} };
const pf = await preflight(ctx, params);
console.log("preflight", JSON.stringify({ ...pf, balanceOkb: formatEther(pf.balanceOkb) }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
await deployAll(ctx, params, state);
const checks = await verifyDeployment(ctx, params, state);
for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.check}${c.detail ? ` (${c.detail})` : ""}`);

const gasPrice = 20_000_001n;
const rows = state.ledger.map((r) => ({ step: r.step, gas: r.gas.toString(), okbFee: formatEther(r.valueWei), bemFee: Number(r.bemUnits) / 1e8, okbGasAt002gwei: formatEther(r.gas * gasPrice) }));
console.table(rows);
const totalGas = state.ledger.reduce((a, r) => a + r.gas, 0n);
const totalValue = state.ledger.reduce((a, r) => a + r.valueWei, 0n);
const totalBem = state.ledger.reduce((a, r) => a + r.bemUnits, 0n);
console.log(`TOTAL gas ${totalGas} (${formatEther(totalGas * gasPrice)} OKB), OKB fees ${formatEther(totalValue)}, BEM ${Number(totalBem) / 1e8}`);
fs.mkdirSync(new URL("../reports/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../reports/rehearsal-${profileName}.json`, import.meta.url), JSON.stringify({ forkBlock: 76_155_264, params, preflight: pf, state: { ...state, ledger: undefined }, ledger: state.ledger, checks, totals: { gas: totalGas, okbFees: totalValue, bemUnits: totalBem } }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
await connection.close();
if (checks.some((c) => !c.ok)) process.exit(1);
void parseEther;
