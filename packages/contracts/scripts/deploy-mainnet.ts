// The real deployment to X Layer mainnet. It spends the deploy wallet's OKB and BEM.
//
//   node --env-file=.env packages/contracts/scripts/deploy-mainnet.ts
//
// It refuses to run unless ALL of these hold:
//   1. DEPLOY_KEY is set (in a gitignored .env; it is never printed or logged).
//   2. CONFIRM_MAINNET is exactly "I_APPROVED_THE_GATE_B_TABLE".
//   3. packages/contracts/deploy/approved.json exists and its fees match the live TapeOut fees
//      and the parameters below. If TapeOut changed a fee since approval, it stops.
//   4. The deploy wallet holds enough OKB and BEM.
// It resumes safely: a re-run skips every step the state file records as done.
import fs from "node:fs";
import { createPublicClient, createWalletClient, fallback, formatEther, http, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { XLAYER } from "@gavelock/core";
import { deployAll, preflight, verifyDeployment, type Context, type DeployParams, type State } from "../deploy/plan.ts";
import { PROPOSED } from "../deploy/proposed.ts";

const here = (p: string) => new URL(p, import.meta.url);
const fail = (message: string): never => {
  console.error(`Stopped: ${message}`);
  process.exit(1);
};

const key = process.env.DEPLOY_KEY;
if (!key) fail("DEPLOY_KEY is not set.");
if (process.env.CONFIRM_MAINNET !== "I_APPROVED_THE_GATE_B_TABLE") fail('set CONFIRM_MAINNET=I_APPROVED_THE_GATE_B_TABLE to confirm the owner approved the Gate B table.');
if (!fs.existsSync(here("../deploy/approved.json"))) fail("deploy/approved.json does not exist: the owner has not approved a table yet.");

const account = privateKeyToAccount((key!.startsWith("0x") ? key! : `0x${key}`) as Hex);
const chain = defineChain({ id: XLAYER.id, name: XLAYER.name, nativeCurrency: XLAYER.nativeCurrency, rpcUrls: { default: { http: [...XLAYER.rpcUrls] } } });
const transport = fallback(XLAYER.rpcUrls.map((url) => http(url, { retryCount: 3, retryDelay: 1500 })));
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });

interface Approved {
  approvedAt: string;
  feeRecipient: `0x${string}`;
  deployFeeUnits: string;
  mintFeeUnits: string;
  tapeoutFeeWei: string;
  ruleFeeWei: string;
  tenderFeeWei: string;
  supply: string;
}
const approved: Approved = JSON.parse(fs.readFileSync(here("../deploy/approved.json"), "utf8"));
const params: DeployParams = { ...PROPOSED, feeRecipient: approved.feeRecipient };
if (params.ruleFee.toString() !== approved.ruleFeeWei || params.tenderFee.toString() !== approved.tenderFeeWei || params.supply.toString() !== approved.supply) fail("deploy/proposed.ts no longer matches deploy/approved.json.");

const statePath = here("../deploy/state.xlayer.json");
const state: State = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8"), (_, v) => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) : { ledger: [] };
const save = (s: State) => fs.writeFileSync(statePath, JSON.stringify(s, (_, v) => (typeof v === "bigint" ? `${v}n` : v), 2) + "\n");
const ctx: Context = { pub: pub as never, wallet: wallet as never, account: account.address, artifactsDir: here("../artifacts/"), log: (l) => console.log(`  ${l}`), save };

const pf = await preflight(ctx, params);
console.log(`wallet ${account.address}: ${formatEther(pf.balanceOkb)} OKB, ${Number(pf.balanceBem) / 1e8} BEM`);
if (pf.chainId !== XLAYER.id) fail(`connected to chain ${pf.chainId}, not X Layer.`);
if (pf.deployFee.toString() !== approved.deployFeeUnits || pf.mintFee.toString() !== approved.mintFeeUnits || pf.tapeoutFee.toString() !== approved.tapeoutFeeWei) {
  fail(`TapeOut's fees changed since approval (processor ${pf.deployFee}, mint ${pf.mintFee}, tape-out ${pf.tapeoutFee}). Show the owner the new table.`);
}
if (pf.balanceBem < pf.bemNeeded) fail(`needs ${Number(pf.bemNeeded) / 1e8} BEM, holds ${Number(pf.balanceBem) / 1e8}.`);
if (pf.balanceOkb < pf.okbFeesNeeded + 5n * 10n ** 15n) fail(`needs about ${formatEther(pf.okbFeesNeeded + 5n * 10n ** 15n)} OKB for fees and gas, holds ${formatEther(pf.balanceOkb)}.`);

await deployAll(ctx, params, state);
const checks = await verifyDeployment(ctx, params, state);
for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.check}${c.detail ? ` (${c.detail})` : ""}`);
if (checks.some((c) => !c.ok)) fail("a post-deployment check failed. Do not use these contracts; see the lines above.");
const out = { chainId: XLAYER.id, deployedBy: account.address, ruleStock: state.stock, processor: state.processor, transistors: state.transistors, awardEngine: state.engine, tenders: state.gavelock, panel: state.panel, records: state.records, rules: state.rules };
fs.writeFileSync(here("../deploy/deployed.xlayer.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
