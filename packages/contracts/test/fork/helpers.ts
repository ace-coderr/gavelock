// Shared setup for tests that run against a fork of X Layer mainnet.
import { network } from "hardhat";
import { parseAbi, type Address, type Hex } from "viem";
import { TAPEOUT } from "@gavelock/core";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const tapeoutAbi = parseAbi([
  "function deployFee() view returns (uint256)",
  "function cpuCount() view returns (uint256)",
  "function isCPU(address) view returns (bool)",
  "function mint(uint256 id, uint256 amount)",
  "function mintPrice() view returns (uint256)",
  "function protocolFee() view returns (uint256)",
  "function supplyCap() view returns (uint256)",
  "function minted() view returns (uint256)",
  "function creator() view returns (address)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function TAPEOUT_FEE() view returns (uint256)",
  "function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)",
  "function eval(uint256 id, bytes inputs) view returns (bytes)",
  "function circuitInfo(uint256) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)",
  "function netlist(uint256) view returns (bytes)",
  "function nextId() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function name() view returns (string)",
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
]);

/** An address that holds the fee token on mainnet. Fork only: tests take what they need from it. */
const FEE_TOKEN_HOLDER: Address = "0x571d447f4f24688eC35Ccf07f1D6993655F6aF15";

export async function connectFork() {
  const connection = await network.create({ network: "xlayerFork", chainType: "op" });
  const { viem } = connection;
  const pub = await viem.getPublicClient();
  const test = await viem.getTestClient();
  const wallets = await viem.getWalletClients();

  /** Give an account fee tokens by moving them from an existing holder (impersonated on the fork). */
  async function fundFeeToken(to: Address, amount: bigint) {
    await test.impersonateAccount({ address: FEE_TOKEN_HOLDER });
    await test.setBalance({ address: FEE_TOKEN_HOLDER, value: 10n ** 18n });
    const holder = await viem.getWalletClient(FEE_TOKEN_HOLDER);
    const hash = await holder.writeContract({ address: TAPEOUT.bem, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
    await pub.waitForTransactionReceipt({ hash });
    await test.stopImpersonatingAccount({ address: FEE_TOKEN_HOLDER });
  }

  /** Wait for a transaction and return its receipt; throws if it reverted. */
  async function mined(hash: Hex) {
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return receipt;
  }

  return { connection, viem, pub, test, wallets, fundFeeToken, mined };
}

/** The short reason a call failed with, for asserting on reverts. */
export async function revertOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    const e = error as { cause?: unknown; shortMessage?: string; message?: string; details?: string };
    const parts: string[] = [];
    for (let c: any = e; c; c = c.cause) {
      if (c.data?.errorName) parts.push(String(c.data.errorName));
      if (c.reason) parts.push(String(c.reason));
      if (c.shortMessage) parts.push(String(c.shortMessage));
      if (c.details) parts.push(String(c.details));
      if (c.message) parts.push(String(c.message).split("\n")[0]!);
    }
    return parts.join(" | ") || "reverted";
  }
  return "";
}
