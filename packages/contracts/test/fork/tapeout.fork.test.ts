// Smoke test for the fork setup: the simulated network must see the real TapeOut contracts.
// Everything Gavelock's own contracts rely on is re-checked here, so a TapeOut change shows up as a failing test.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, parseAbi, parseEther, type Address, type PublicClient } from "viem";
import { MULTICALL3, RULE_SHAPE, TAPEOUT } from "@gavelock/core";

const abi = parseAbi([
  "function deployFee() view returns (uint256)",
  "function bem() view returns (address)",
  "function cpuCount() view returns (uint256)",
  "function cpuAt(uint256) view returns (address)",
  "function isCPU(address) view returns (bool)",
  "function isSealed() view returns (bool)",
  "function implementation() view returns (address)",
  "function owner() view returns (address)",
  "function decimals() view returns (uint8)",
  "function TAPEOUT_FEE() view returns (uint256)",
  "function circuitInfo(uint256) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)",
  "function eval(uint256 id, bytes inputs) view returns (bytes)",
]);

// A third-party processor that has been live since October 2026, used only as a read target.
const LIVE_PROCESSOR: Address = "0xDa659F36172E644424D4C009BdCEC23818F0a2F9";

describe("X Layer fork: TapeOut as Gavelock expects it", () => {
  let pub: PublicClient;

  before(async () => {
    const { viem } = await network.create({ network: "xlayerFork", chainType: "op" });
    pub = (await viem.getPublicClient()) as unknown as PublicClient;
  });

  const read = <T>(address: Address, functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ address, abi, functionName, args } as never) as Promise<T>;

  it("is chain 196", async () => {
    assert.equal(await pub.getChainId(), 196);
  });

  it("has the factory, charging the processor fee in BEM", async () => {
    assert.equal(getAddress(await read<Address>(TAPEOUT.factory, "bem")), getAddress(TAPEOUT.bem));
    assert.equal(await read<number>(TAPEOUT.bem, "decimals"), 8);
    assert.ok((await read<bigint>(TAPEOUT.factory, "deployFee")) > 0n);
    assert.ok((await read<bigint>(TAPEOUT.factory, "cpuCount")) >= 424n);
  });

  it("has an owner-less circuit beacon pointing at the implementation Gavelock was designed against", async () => {
    assert.equal(getAddress(await read<Address>(TAPEOUT.circuitBeacon, "implementation")), getAddress(TAPEOUT.circuitImplementation));
    assert.equal(await read<Address>(TAPEOUT.circuitBeacon, "owner"), "0x0000000000000000000000000000000000000000");
  });

  it("evaluates a live circuit to the value mainnet returns", async () => {
    assert.equal(await read<boolean>(TAPEOUT.factory, "isCPU", [LIVE_PROCESSOR]), true);
    assert.equal(await read<bigint>(LIVE_PROCESSOR, "TAPEOUT_FEE"), parseEther("0.0013"));
    const [nIn, nOut, nState] = await read<readonly [number, number, number, number]>(LIVE_PROCESSOR, "circuitInfo", [2n]);
    assert.deepEqual([nIn, nOut, nState], [8, 7, 0]);
    assert.equal(await read<string>(LIVE_PROCESSOR, "eval", [2n, "0x87"]), "0x40");
    assert.equal(await read<string>(LIVE_PROCESSOR, "eval", [1n, "0x87"]), "0x00");
  });

  it("has Multicall3 and the rule shape fits in two input bytes and one output byte", async () => {
    const code = await pub.getCode({ address: MULTICALL3 });
    assert.ok(code && code.length > 2);
    assert.equal(Math.ceil(RULE_SHAPE.inputs / 8), 2);
    assert.equal(Math.ceil(RULE_SHAPE.outputs / 8), 1);
  });
});
