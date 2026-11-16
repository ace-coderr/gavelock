# Protocol findings (Task 0)

Everything below was read from X Layer mainnet (chain 196, `https://rpc.xlayer.tech`) or measured on an
in-process Hardhat fork of it on **16 November 2026** (blocks 76,047,794 to 76,049,935). Nothing was sent
to mainnet. Each claim names the script that produced it; raw output is in `spike/out/`.

Reproduce:

```
cd spike && npm install
node scripts/verify-chain.mjs      # addresses, signatures, fees, eval, RPC behaviour
node scripts/verify-extra.mjs      # beacons, newest processors, logs by block, other nodes
node scripts/verify-evm.mjs        # opcodes, calldata price, code size limit, eth_call gas cap
node scripts/verify-trust.mjs      # who can still change what, and since when
node scripts/probe-create.mjs      # why createCPU no longer accepts OKB
node scripts/probe-bem.mjs         # the fee token
node scripts/probe-bem-price.mjs   # where it trades
node scripts/probe-new-cpu.mjs     # how a processor created this week mints and tapes out
node scripts/size-rules.mjs        # starter rules -> NAND netlists, checked on all 2,048 inputs
npx hardhat run scripts/fork-costs.ts --network xlayerFork   # the cost measurements
node scripts/tlock-check.mjs       # tlock-js against drand quicknet (Node)
node scripts/browser/serve.mjs     # the same check bundled for a browser, on 127.0.0.1:4173
```

## 1. What changed since the reference repos were written

The reference documents (Cerebr `TAPEOUT.md` of 4 October, the x402-doctor DeWEB script of 27 October)
describe fees that are no longer true. The factory was upgraded between 4 and 9 November 2026.

| Assumption in the brief or the references | What the chain says today | Smallest change |
|---|---|---|
| Creating a processor costs 0.0066 OKB | It costs **0.1 BEM** (ERC-20 `0x60e6…3952`, 8 decimals), taken through an allowance to the factory. `createCPU` reverts if any OKB is sent. | The deploy wallet holds BEM as well as OKB. See section 7. |
| Minting transistors costs 0.00066 OKB per call | On processors created after the upgrade it costs **0.01 BEM per call**, any amount, through an allowance to the transistors contract. `mint` reverts if OKB is sent. | Mint once, in bulk. Buyers who build a rule should not need BEM at all: see section 6. |
| Tape-out costs 0.0013 OKB | Unchanged: exactly 0.0013 OKB, in OKB. | None. |
| TapeOut contracts are upgradeable by their owner | Partly. The **factory** is a UUPS proxy owned by `0xB3D8…3138` and is not sealed. The **beacons** behind every processor (circuits and transistors) now have owner `0x0`: ownership was given up between 12 October and 4 November. The code that stores netlists and runs `eval` can no longer be replaced. | Word the honest limit precisely (section 8). |
| The app can read events | `eth_getLogs` on the public node is limited to a 100-block range. A single old block can still be read. | Every on-chain record stores its block number; the app reads state from views and fetches logs one block at a time. |
| Hardhat forks X Layer as it would any EVM chain | X Layer is an OP-stack chain (reth client, deposit transactions, 1-second blocks, Prague opcodes) and the simulator has no hardfork history for chain 196. | The Hardhat config declares chain type `op` with the Isthmus rule set from block 0. |

Everything else in the brief held: the factory address, the `tapeout` / `eval` / `REF` interfaces, the
netlist format, a contract calling `eval`, and tlock-js in the browser.

## 2. Addresses (chain 196)

| What | Address | Checked |
|---|---|---|
| Processor factory (UUPS proxy) | `0x1f09daefa827f02cbb40967cc91b259763760761` | implementation `0x336e9f0f4c3fee7c8c803377e4dea00293f4ae2a`, owner `0xB3D85b42A045c1A88D800CAD0F55d2566a4D3138`, `isSealed()` false, 424 processors |
| Circuit beacon | `0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C` | implementation `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2` (same since at least block 71,049,555), owner `0x0` |
| Transistor beacon, processors created after the upgrade | `0x41cb2bfd1ccca8f505eedad0181eef44f1b9ce65` | implementation `0x44Ebf3345bcf9aB329e7a28E53fd8EcfAd1a5EFE`, owner `0x0` |
| Transistor beacon, older processors | `0x1059Ad62cAbB6a6925bb65aA617300556c60A51B` | implementation `0x265bf10faB9ddEC0eE0A649C6B9DB845f1b9a06b`, owner `0x0` |
| BEM (fee token) | `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952` | 8 decimals, total supply 16,097.1 BEM, owner `0xB3D8…3138` |
| BEM / WOKB pool (1% fee tier) | `0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A` | 2,576.6 BEM and 204.6 WOKB; 1 BEM = 0.114 OKB |
| Protocol wallet (receives BEM fees) | `0x571d447f4f24688eC35Ccf07f1D6993655F6aF15` | |
| Tape-out treasury | `0xEBeceDeA36e598b64E17f8d519EB77441C539F76` | receives the 0.0013 OKB |
| Container opener | `0x536add8f30f03b69f6fbf29d425a816a0dc50106` | `FEE()` 0.08 OKB |
| SiteRegistry (proxy) | `0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6` | implementation `0xa85c4143d1d4a77f54b8e4ecc9e6d1418afea45f` |
| DomainBinding (proxy) | `0x68809fd2fb343aa57d0aeb7f33defe477c9666f9` | implementation `0x5ebf29b80789e548907c707530c3c7607c4347df`, `monthlyFee()` 0 |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | present |

## 3. Interfaces, as verified

**Factory**

- `createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) returns (address transistors, address circuits)`, selector `0x47f9b5fd`. Needs a BEM allowance of `deployFee()` = 10,000,000 units (0.1 BEM). Without it: `ERC20InsufficientAllowance`. With OKB attached: revert. 776,757 gas on the fork.
- `event CPUCreated(address indexed circuits, address indexed transistors, address indexed creator, string name, uint256 supply, uint256 mintPrice)`.
- `cpuCount()`, `cpuAt(i)`, `isCPU(circuits)`, `deployFee()`, `protocolFee()`, `bem()`, `owner()`, `isSealed()`.
- The next processor would be number 424.

**Transistors** (ERC-1155, one per processor; ids `NAND() = 0`, `LATCH() = 1`)

- `mint(uint256 id, uint256 amount)`, selector `0x1b2ef1ca`. On a new processor: needs a BEM allowance of `amount * mintPrice + protocolFee`, where `protocolFee()` = 1,000,000 units (0.01 BEM) per call. 176,211 gas for the first mint, 83,111 after.
- Seen on mainnet this week: processor 423 minted 815 NAND with 0 OKB and a 0.01 BEM transfer (`spike/out/probe-new-cpu.json`).

**Circuits** (ERC-721, one per processor: this is "the processor")

- `tapeout(bytes netlist, uint32 nIn, uint32 nOut) payable returns (uint256 id)`, selector `0x7bd3ac1d`. `msg.value` must equal `TAPEOUT_FEE()` = 0.0013 OKB exactly; one wei more reverts. Burns one NAND per NAND record from the caller. Ids start at 1.
- `eval(uint256 id, bytes inputs) view returns (bytes)`, selector `0x934d06ea`. Free to call. Reverts `no circuit` for an unknown id.
- `circuitInfo(id) returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)`, `netlist(id) returns (bytes)` (returns exactly what was submitted), `nextId()` (the last assigned id), `step`, `ownerOf`.
- `event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)`.

**Netlist format** (TAP-02; verified by taping out six circuits and reading them back)

- Signals: 0 is constant 0, 1 is constant 1, input `i` is signal `2 + i`, then each record appends its outputs.
- NAND record: `00 a:u24 b:u24` (7 bytes, big-endian). Inputs must point backwards.
- REF record: `02 processor:20 bytes, id:u64, nIns:u8, nOuts:u8, ins:u24 × nIns`. Verified: a 64-byte netlist holding one REF to an 11-in / 5-out rule taped out, burned 0 NAND, reported the target's 141 gates and matched it on 56 of 56 sampled inputs. A wrong pin count reverts. REF targets are limited to 255 inputs and 255 outputs.
- Outputs are the last `nOut` signals produced by records, in order. They can never be inputs or constants.
- Bit packing: bit `i` is bit `i mod 8` of byte `floor(i / 8)`. Outputs come back as `ceil(nOut / 8)` bytes. Short inputs read as zeros, extra bytes are ignored: the tender contract must always build the input itself.

**Limits**

- Inputs and outputs: up to 65,536 each according to TAP-02 (not exercised here; Gavelock uses 11 and 5). No gate limit other than gas: 3,296 gates taped out in one transaction.
- Gas: tape-out is about 210,000 + 2,850 per NAND; `eval` is about 55,000 + 2,300 per NAND.
- Block gas limit 210,000,000. Simulation with validation accepted a single transaction with a 200,000,000 gas limit, so no lower per-transaction cap was observed. Gavelock will still keep every transaction under 15,000,000 gas.
- `eth_call` on the public node is capped at 50,000,000 gas. This sets the batch size for reading truth tables.

**A contract can call `eval`.** `spike/contracts/EvalProbe.sol`, deployed on the fork, called it inside a
transaction and stored the result; the answer matched the truth table. A guarded version (staticcall with
a gas cap, length checks) returned "not ok" instead of reverting when given too little gas or a missing
circuit. That is the pattern the tender contract will use.

## 4. Rule circuits

Layout used for sizing (the final layout is fixed in Task 2): 11 input bits (price band 3, delivery band 2,
mandatory compliance 1, preferred criteria 2, panel band 3) and 5 output bits (eligible 1, score 4). The whole
input space is 2,048 cases.

| Rule | NAND gates | Tape-out gas | `eval` gas | Checked on chain |
|---|---|---|---|---|
| Lowest compliant price | 15 | 283,424 | 86,457 | 2,048 / 2,048 |
| Price 60 / Quality 40 | 141 | 605,751 | 375,099 | 2,048 / 2,048 |
| Quality 70 / Price 30 | 129 | 571,957 | 347,957 | 2,048 / 2,048 |
| Fastest compliant delivery | 75 | 419,037 | 223,615 | 2,048 / 2,048 |
| Custom rule reading every input | 576 | 1,842,523 | 1,370,016 | 2,048 / 2,048 |
| Worst case: random table | 3,296 | 9,596,677 | 7,622,200 | 256 / 256 sampled |

`eval` gas is the full cost as a transaction, including the 21,000 base. Each rule was compiled from its
scoring function to a truth table to a NAND netlist, checked against the table on every input in a local
simulator, taped out on the fork, then checked again through `eval` on the fork.

Consequences for the design:

- Any rule the form can express fits. The Rule Prover reads a starter rule's full table in 16 to 32 batched calls.
- A random table costs 7.6M gas per bid to evaluate. The rule builder should refuse netlists above about 1,500 NAND, which still leaves room for every weighted rule.
- `finalize()` costs one `eval` per valid bid. It takes a batch size so no transaction grows with the number of bids.

## 5. Chain behaviour the app depends on

| Fact | Value | Source |
|---|---|---|
| Client | reth, OP-stack (`0x7e` deposit transactions) | `verify-evm`, receipt fields |
| Block time | 1.000 s averaged over 1,000 blocks | `verify-evm` |
| Gas price | 0.02 gwei (20,000,001 wei), base fee 20,000,000 wei | `verify-chain` |
| L1 data fee | 0 (both scalars are 0 in receipts) | receipt of `0x7a89…637a` |
| Opcodes | PUSH0, MCOPY, TSTORE, BLOBBASEFEE work; BLS12-381 precompiles present | `verify-evm` |
| Calldata | 40 gas per non-zero byte (EIP-7623 floor) | `verify-evm` |
| Contract size limit | 24,576 bytes; 24,577 is rejected | `verify-evm` |
| `eth_getLogs` | at most 100 blocks per request; a block six weeks old still returns its logs | `verify-extra` |
| Historical state | available at least 200,000 blocks back | `verify-chain` |
| CORS | `rpc.xlayer.tech` and `xlayer.drpc.org` send `access-control-allow-origin: *` | `verify-extra` |
| `eth_simulateV1` | only on `xlayer.drpc.org` | `verify-extra` |
| SHA-256 precompile | works | `verify-evm` |

Storage choices that follow:

- **Documents** go in an event with the SHA-256 computed on chain, and the contract stores the hash, size and block number. Measured: 2,000 bytes 118,407 gas; 24,000 bytes 982,240 gas; 100,000 bytes 4,022,270 gas (0.00008 OKB). Large files are split into chunks of at most 60,000 bytes.
- **Sealed bids** keep the ciphertext as contract code, so the seal check works from a view and does not depend on a node keeping old logs. Measured with commitment and deposit: 400 bytes 232,713 gas; 700 bytes 280,554 gas; 1,500 bytes 453,873 gas.

## 6. Time-lock sealing

- `tlock-js` 0.9.0 against drand quicknet (chain hash `52db9ba7…e971`, 3-second rounds, scheme `bls-unchained-g1-rfc9380`).
- Node: a 448-byte bid (240-character note) seals to 807 bytes of binary ciphertext in 289 ms. Opening before the round is refused. After the round it opens and the commitment matches. Sealing to a round 30 days ahead works.
- Browser (Chromium 156, bundle built with esbuild, no external scripts): chain info fetched, sealed in 139 ms, refused early, opened after the round in 501 ms. The library adds 162 KB minified.
- Endpoints with CORS for browsers: `api.drand.sh`, `api2.drand.sh`, `drand.cloudflare.com`.
- The ciphertext names its own round. A bidder who seals to the wrong round only harms themselves (opens early, or cannot be opened in the window and is void), so the contract does not need to parse it. The app flags it in the seal check.
- The deadline is rounded up to a drand round at tender creation and both are stored.

## 7. Cost table

Gas is priced at 0.02 gwei. BEM is converted at 0.114 OKB (pool price on 16 November, before the 1% pool fee).
All TapeOut fees are set by the factory owner and can change: the deploy script reads them live and stops
if they differ from this table.

### One-time setup (measured on the fork)

| Step | Gas | Fee | Gas cost in OKB |
|---|---|---|---|
| Approve BEM for the factory | 46,393 | | 0.0000009 |
| Create the Gavelock processor | 776,757 | 0.1 BEM | 0.0000155 |
| Approve BEM for the transistors contract | 46,381 | | 0.0000009 |
| Mint NAND transistors, one call, any amount | 176,211 | 0.01 BEM | 0.0000035 |
| Tape out "Lowest compliant price" | 283,424 | 0.0013 OKB | 0.0000057 |
| Tape out "Price 60 / Quality 40" | 605,751 | 0.0013 OKB | 0.0000121 |
| Tape out "Quality 70 / Price 30" | 571,957 | 0.0013 OKB | 0.0000114 |
| Tape out "Fastest compliant delivery" | 419,037 | 0.0013 OKB | 0.0000084 |
| **Setup total** | 2,925,911 | **0.11 BEM + 0.0052 OKB** | **0.0000585** |

In OKB terms: 0.11 BEM is about 0.0127 OKB, so setup is about **0.018 OKB**.

### Contracts and tenders (estimates until the contracts exist; exact figures at Gate B)

| Item | Gas | OKB | Basis |
|---|---|---|---|
| Deploy the tender contract | up to 6,000,000 | up to 0.00012 | 231 gas per byte measured on the probe, at the 24,576-byte limit |
| Deploy a second contract if the code must be split | up to 6,000,000 | up to 0.00012 | same |
| One full tender, 3 bidders, 3 panel members | about 6,600,000 | about 0.00013 | measured primitives: 24 KB document 982,240; three sealed bids 3 × 280,554; three scored bids 1,173,287; the rest estimated at 60,000 to 300,000 per call |
| One Quick Quote, 3 quotes | about 3,000,000 | about 0.00006 | same primitives, no panel |
| A buyer taping out a custom rule | 300,000 to 1,900,000 | 0.0013 fee + up to 0.00004 | measured |

The tender fee and the bid deposits are not costs to the project: the fee is paid to Gavelock's own fee
address and deposits are returned.

### DeWEB (Gate C, dry run only)

| Item | Fee in OKB | Note |
|---|---|---|
| Open the site container | 0.08 | `opener.FEE()`, simulated successfully against the fork processor |
| Bind the on-chain name | 0 | `monthlyFee()` is 0 today |
| Upload the site | about 0.005 per MB | estimate: 246 gas per byte; measured for real in the Gate C dry run |

### What the deploy wallet needs

| Scope | OKB | BEM |
|---|---|---|
| Processor, four rules, contracts, one full tender, one Quick Quote | 0.03 (0.0052 fees, the rest is gas and margin) | 0.15 (0.11 needed) |
| Adding the DeWEB publish later | + 0.10 | |

0.15 BEM costs about 0.0173 OKB at today's pool price, so if the BEM is bought from the same wallet,
fund it with about **0.05 OKB** in total. The demo tenders also need small gas balances (0.0005 OKB each)
in the bidder and panel wallets.

## 8. Trust boundaries (for the README's honest limits)

- Gavelock's own contracts: no owner, no upgrade path.
- TapeOut circuits contract (`eval`, `netlist`): the implementation behind the beacon cannot be changed, because the beacon has no owner. This was read on 16 November 2026 at block 76,049,555 and is cheap to re-check: the tender contract can expose the beacon's implementation address next to the value recorded at deployment.
- TapeOut factory: upgradeable by `0xB3D8…3138`, not sealed. It controls the price of creating processors and minting, and the `isCPU` registry used by REF records. Gavelock's rules are flat NAND netlists with no REF, so an existing rule does not depend on the factory after tape-out.
- BEM token and the opener, SiteRegistry and DomainBinding proxies: controlled by TapeOut. They affect setup cost and the DeWEB copy of the site, not tenders.
- drand quicknet: a bid is sealed until the League of Entropy publishes the round. If the network halted, bids could not be opened; they would be void and deposits handled by the tender's own rules.
- After opening, bids are public.

## 9. Proposed changes to the plan

1. **Buy BEM before Gate B.** The deploy wallet needs 0.15 BEM. Swapping is a trade, so it is yours to do: the BEM / WOKB pool above is where it trades.
2. **Custom rules without BEM.** A buyer taping out a rule needs NAND transistors, and minting them now needs BEM. Proposal: a small contract with no owner holds a stock of pre-minted NAND and performs the tape-out for the caller, who pays the 0.0013 OKB and receives the circuit. One extra mint call (0.01 BEM) fills the stock. To be proven on the fork in Task 3.
3. **Records carry their block number**, so tx hashes and document bytes are recoverable one block at a time.
4. **Ciphertexts as contract code, documents in events**, as measured in section 5.
5. **Paged `finalize()`** and a 1,500-NAND cap in the rule builder.
