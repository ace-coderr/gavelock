import { defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";

// In-process fork of X Layer mainnet. Nothing here can send a transaction to the real chain:
// the only network defined is a simulated one.
export default defineConfig({
  plugins: [hardhatViem],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  chainDescriptors: {
    // X Layer runs an OP-stack client with Prague-level opcodes (verified in scripts/verify-evm.mjs).
    // Isthmus is the matching rule set and the newest one the simulator knows.
    196: { name: "X Layer", chainType: "op", hardforkHistory: { isthmus: { blockNumber: 0 } } },
  },
  networks: {
    xlayerFork: {
      type: "edr-simulated",
      chainType: "op",
      chainId: 196,
      blockGasLimit: 210_000_000,
      forking: { url: process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech" },
    },
  },
});
