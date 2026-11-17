// Add starter rules to an existing deployment. One command per decision:
//
//   CONFIRM_MAINNET=I_APPROVED_THE_GATE_B_TABLE node --env-file=.env packages/contracts/scripts/add-rules.ts lowest-price quality-70-price-30 fastest-delivery
//
// Use the keys of the rules you want, or "all" for every starter rule not yet taped out. It needs the same
// safeguards as the deployment: the deploy key, the confirmation phrase, the approval file, and a live TapeOut
// tape-out fee equal to the approved one. Each rule costs the TapeOut fee plus the rule fee, in OKB only.
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, fallback, formatEther, http, bytesToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { STARTER_RULES, XLAYER, compileRule, encodeNetlist, truthTable } from "@gavelock/core";
import { loadArtifact } from "../deploy/plan.ts";

const here = (p: string) => new URL(p, import.meta.url);
const fail = (m: string): never => {
  console.error(`Stopped: ${m}`);
  process.exit(1);
};
const key = process.env.DEPLOY_KEY;
if (!key) fail("DEPLOY_KEY is not set.");
if (process.env.CONFIRM_MAINNET !== "I_APPROVED_THE_GATE_B_TABLE") fail("set CONFIRM_MAINNET=I_APPROVED_THE_GATE_B_TABLE.");
if (!fs.existsSync(here("../deploy/approved.json")) || !fs.existsSync(here("../deploy/deployed.xlayer.json"))) fail("there is no approved, completed deployment to add rules to.");
const approved = JSON.parse(fs.readFileSync(here("../deploy/approved.json"), "utf8"));
const deployed = JSON.parse(fs.readFileSync(here("../deploy/deployed.xlayer.json"), "utf8")) as { ruleStock: Address; processor: Address; rules: Record<string, number> };

const wanted = process.argv.slice(2);
if (wanted.length === 0) fail("name the rules to add, or \"all\". Available: " + STARTER_RULES.map((r) => r.key).join(", "));
const keys = wanted.includes("all") ? STARTER_RULES.map((r) => r.key) : wanted;
for (const k of keys) if (!STARTER_RULES.some((r) => r.key === k)) fail(`unknown rule "${k}".`);
const todo = STARTER_RULES.filter((r) => keys.includes(r.key) && deployed.rules[r.key] === undefined);
if (todo.length === 0) fail("those rules are already taped out.");

const account = privateKeyToAccount((key!.startsWith("0x") ? key! : `0x${key}`) as Hex);
const chain = defineChain({ id: XLAYER.id, name: XLAYER.name, nativeCurrency: XLAYER.nativeCurrency, rpcUrls: { default: { http: [...XLAYER.rpcUrls] } } });
const transport = fallback(XLAYER.rpcUrls.map((url) => http(url, { retryCount: 3, retryDelay: 1500 })));
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
const stock = loadArtifact(here("../artifacts/"), "RuleStock");

const price = (await pub.readContract({ address: deployed.ruleStock, abi: stock.abi, functionName: "tapeOutPrice" })) as bigint;
if (price.toString() !== (BigInt(approved.tapeoutFeeWei) + BigInt(approved.ruleFeeWei)).toString()) fail(`the tape-out price is now ${formatEther(price)} OKB, not the approved ${formatEther(BigInt(approved.tapeoutFeeWei) + BigInt(approved.ruleFeeWei))}.`);
const balance = await pub.getBalance({ address: account.address });
if (balance < price * BigInt(todo.length) + 10n ** 15n) fail(`needs about ${formatEther(price * BigInt(todo.length) + 10n ** 15n)} OKB, holds ${formatEther(balance)}.`);

for (const rule of todo) {
  const compiled = compileRule(truthTable(rule.spec));
  const netlist = bytesToHex(encodeNetlist(compiled.netlist));
  const { result } = await pub.simulateContract({ address: deployed.ruleStock, abi: stock.abi, functionName: "tapeOut", args: [netlist, rule.name], value: price, account } as never);
  const hash = await wallet.writeContract({ address: deployed.ruleStock, abi: stock.abi, functionName: "tapeOut", args: [netlist, rule.name], value: price, account } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") fail(`tape-out of "${rule.name}" reverted: ${hash}`);
  deployed.rules[rule.key] = Number(result);
  fs.writeFileSync(here("../deploy/deployed.xlayer.json"), JSON.stringify(deployed, null, 2) + "\n");
  console.log(`"${rule.name}" (${compiled.gates} NAND): circuit ${result}, ${receipt.gasUsed} gas, ${hash}`);
}
console.log("Done. Now run the checks again (the web app and the Rule Prover read the new circuit ids from the chain).");
