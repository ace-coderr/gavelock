import { defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";

// The only network defined here is a simulated fork of X Layer mainnet. Tests run against the real
// TapeOut contracts' code and state without being able to send anything to the real chain.
// Mainnet deployment is configured separately at Gate B.
export default defineConfig({
  plugins: [hardhatViem, hardhatNodeTestRunner],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  chainDescriptors: {
    // X Layer is an OP-stack chain with Prague-level opcodes. Isthmus is the matching rule set.
    196: { name: "X Layer", chainType: "op", hardforkHistory: { isthmus: { blockNumber: 0 } } },
  },
  networks: {
    xlayerFork: {
      type: "edr-simulated",
      chainType: "op",
      chainId: 196,
      blockGasLimit: 210_000_000,
      // Pinned to one block so every RPC response is cached after the first run. Bump it deliberately.
      forking: { url: process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech", blockNumber: 76_155_264 },
    },
  },
});
