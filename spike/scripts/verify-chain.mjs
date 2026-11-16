// Read-only verification of TapeOut on X Layer mainnet (chainId 196). Sends nothing.
//   node scripts/verify-chain.mjs
import { createPublicClient, http, parseAbi, encodeFunctionData, formatEther, toFunctionSelector, keccak256 } from 'viem';
import { xLayer } from 'viem/chains';
import fs from 'node:fs';

const RPC = process.env.XLAYER_RPC_URL || 'https://rpc.xlayer.tech';
const pub = createPublicClient({ chain: xLayer, transport: http(RPC, { retryCount: 4, retryDelay: 1200 }) });

export const A = {
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  opener: '0x536add8f30f03b69f6fbf29d425a816a0dc50106',
  siteRegistry: '0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6',
  domainBinding: '0x68809fd2fb343aa57d0aeb7f33defe477c9666f9',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  // Existing third-party processors, used only as read targets for eval measurements.
  sample72: { circuits: '0xDa659F36172E644424D4C009BdCEC23818F0a2F9', id: 1n, input: '0x87', expect: '0x00' },
  sample70: { circuits: '0xDa659F36172E644424D4C009BdCEC23818F0a2F9', id: 2n, input: '0x87', expect: '0x40' },
  sample40: { circuits: '0x12FA3aF78B22E9AC3f0afc5D2bf907601a1cA725', id: 1n, input: '0x00' },
};
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

const abi = parseAbi([
  'function deployFee() view returns (uint256)',
  'function protocolFee() view returns (uint256)',
  'function cpuCount() view returns (uint256)',
  'function cpuAt(uint256) view returns (address)',
  'function isCPU(address) view returns (bool)',
  'function owner() view returns (address)',
  'function isSealed() view returns (bool)',
  'function circuitBeacon() view returns (address)',
  'function transistorBeacon() view returns (address)',
  'function implementation() view returns (address)',
  'function protocolWallet() view returns (address)',
  'function createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address, address)',
  'function TAPEOUT_FEE() view returns (uint256)',
  'function TREASURY() view returns (address)',
  'function transistors() view returns (address)',
  'function nextId() view returns (uint256)',
  'function name() view returns (string)',
  'function circuitInfo(uint256) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)',
  'function netlist(uint256) view returns (bytes)',
  'function eval(uint256 id, bytes inputs) view returns (bytes)',
  'function step(uint256 id, bytes state, bytes inputs) view returns (bytes, bytes)',
  'function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)',
  'function mint(uint256 id, uint256 amount) payable',
  'function mintPrice() view returns (uint256)',
  'function supplyCap() view returns (uint256)',
  'function minted() view returns (uint256)',
  'function NAND() view returns (uint256)',
  'function LATCH() view returns (uint256)',
  'function FEE() view returns (uint256)',
  'function monthlyFee() view returns (uint256)',
]);

const out = { rpc: RPC, checks: [] };
const rec = (name, value, ok = true) => { out.checks.push({ name, value: typeof value === 'bigint' ? value.toString() : value, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${typeof value === 'bigint' ? value.toString() : JSON.stringify(value)}`); };
const read = (address, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const tryRead = async (address, functionName, args = []) => { try { return await read(address, functionName, args); } catch (e) { return `revert: ${(e.shortMessage || e.message).split('\n')[0]}`; } };
const implOf = async (address) => { const v = await pub.getStorageAt({ address, slot: IMPL_SLOT }); return `0x${v.slice(26)}`; };
const codeSize = async (address) => { const c = await pub.getCode({ address }); return c ? (c.length - 2) / 2 : 0; };

const chainId = await pub.getChainId();
const block = await pub.getBlock();
const gasPrice = await pub.getGasPrice();
rec('chainId', chainId, chainId === 196);
rec('block', Number(block.number));
rec('blockTime', new Date(Number(block.timestamp) * 1000).toISOString());
rec('blockGasLimit', block.gasLimit);
rec('gasPrice(wei)', gasPrice);
rec('baseFeePerGas(wei)', block.baseFeePerGas ?? 'n/a');
out.block = Number(block.number); out.gasPrice = gasPrice.toString();

// ---- factory
rec('factory.codeSize', await codeSize(A.factory), (await codeSize(A.factory)) > 0);
rec('factory.impl(ERC1967)', await implOf(A.factory));
rec('factory.owner', await tryRead(A.factory, 'owner'));
rec('factory.isSealed', await tryRead(A.factory, 'isSealed'));
const deployFee = await read(A.factory, 'deployFee');
const protocolFee = await read(A.factory, 'protocolFee');
rec('factory.deployFee(OKB)', formatEther(deployFee));
rec('factory.protocolFee(OKB)', formatEther(protocolFee));
const cpuCount = await read(A.factory, 'cpuCount');
rec('factory.cpuCount', cpuCount);
const circuitBeacon = await read(A.factory, 'circuitBeacon');
const transistorBeacon = await read(A.factory, 'transistorBeacon');
rec('factory.circuitBeacon', circuitBeacon);
rec('circuitBeacon.implementation', await tryRead(circuitBeacon, 'implementation'));
rec('circuitBeacon.owner', await tryRead(circuitBeacon, 'owner'));
rec('factory.transistorBeacon', transistorBeacon);
rec('transistorBeacon.implementation', await tryRead(transistorBeacon, 'implementation'));
rec('factory.protocolWallet', await tryRead(A.factory, 'protocolWallet'));
rec('selector createCPU', toFunctionSelector('createCPU(string,string,string,uint256,uint256)'));
rec('selector tapeout', toFunctionSelector('tapeout(bytes,uint32,uint32)'));
rec('selector eval', toFunctionSelector('eval(uint256,bytes)'));
rec('selector mint', toFunctionSelector('mint(uint256,uint256)'));
// The selectors must be present in the live implementation bytecode.
const facImplCode = await pub.getCode({ address: await implOf(A.factory) });
rec('createCPU selector in factory impl', facImplCode.includes(toFunctionSelector('createCPU(string,string,string,uint256,uint256)').slice(2)));
const circImpl = await read(circuitBeacon, 'implementation');
const circImplCode = await pub.getCode({ address: circImpl });
for (const sig of ['tapeout(bytes,uint32,uint32)', 'eval(uint256,bytes)', 'step(uint256,bytes,bytes)', 'netlist(uint256)', 'circuitInfo(uint256)', 'nextId()', 'TAPEOUT_FEE()']) {
  const present = circImplCode.includes(toFunctionSelector(sig).slice(2));
  rec(`circuits impl has ${sig}`, present, present);
}
rec('circuits impl codehash', keccak256(circImplCode));
const trImpl = await read(transistorBeacon, 'implementation');
const trImplCode = await pub.getCode({ address: trImpl });
for (const sig of ['mint(uint256,uint256)', 'mintPrice()', 'supplyCap()', 'minted()', 'withdraw()', 'owed(address)']) {
  const present = trImplCode.includes(toFunctionSelector(sig).slice(2));
  rec(`transistors impl has ${sig}`, present, present);
}

// ---- a live processor (read target)
for (const key of ['sample72', 'sample70', 'sample40']) {
  const s = A[key];
  rec(`${key}.isCPU`, await read(A.factory, 'isCPU', [s.circuits]));
  rec(`${key}.name`, await tryRead(s.circuits, 'name'));
  const info = await read(s.circuits, 'circuitInfo', [s.id]);
  rec(`${key}.circuitInfo(nIn,nOut,nState,gates)`, info.map(Number));
  const nl = await read(s.circuits, 'netlist', [s.id]);
  rec(`${key}.netlist bytes`, (nl.length - 2) / 2);
  const r = await read(s.circuits, 'eval', [s.id, s.input]);
  rec(`${key}.eval(${s.input})`, r, s.expect ? r === s.expect : true);
  const data = encodeFunctionData({ abi, functionName: 'eval', args: [s.id, s.input] });
  const gas = await pub.estimateGas({ to: s.circuits, data });
  rec(`${key}.eval gas (incl. 21k base)`, gas);
  out[key] = { gates: Number(info[3]), nIn: Number(info[0]), nOut: Number(info[1]), evalGas: gas.toString() };
}
const s = A.sample72;
rec('circuits.TAPEOUT_FEE(OKB)', formatEther(await read(s.circuits, 'TAPEOUT_FEE')));
rec('circuits.TREASURY', await tryRead(s.circuits, 'TREASURY'));
rec('circuits.nextId (= last id)', await read(s.circuits, 'nextId'));
const tr = await read(s.circuits, 'transistors');
rec('transistors', tr);
rec('transistors.NAND id', await tryRead(tr, 'NAND'));
rec('transistors.LATCH id', await tryRead(tr, 'LATCH'));
rec('transistors.mintPrice(OKB)', formatEther(await read(tr, 'mintPrice')));
rec('transistors.protocolFee(OKB)', formatEther(await read(tr, 'protocolFee')));
rec('transistors.supplyCap', await read(tr, 'supplyCap'));
rec('transistors.minted', await read(tr, 'minted'));

// ---- eval input leniency and width (TAP-02 section 5)
rec('eval with empty input (reads as zeros)', await tryRead(s.circuits, 'eval', [1n, '0x']));
rec('eval with extra bytes (ignored)', await tryRead(s.circuits, 'eval', [1n, '0x87ffff']));
rec('eval of missing circuit', await tryRead(s.circuits, 'eval', [999999n, '0x00']));

// ---- eval through Multicall3: a contract calling eval, on mainnet state, read-only
const mcAbi = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])']);
const calls = Array.from({ length: 16 }, (_, i) => ({ target: s.circuits, allowFailure: false, callData: encodeFunctionData({ abi, functionName: 'eval', args: [1n, `0x${i.toString(16).padStart(2, '0')}`] }) }));
const mc = await pub.readContract({ address: A.multicall3, abi: mcAbi, functionName: 'aggregate3', args: [calls] });
rec('multicall3 -> eval x16 (contract caller)', mc.every((r) => r.success), mc.every((r) => r.success));

// ---- DeWEB pieces
rec('opener.codeSize', await codeSize(A.opener));
rec('opener.FEE(OKB)', formatEther(await read(A.opener, 'FEE')));
rec('siteRegistry.codeSize', await codeSize(A.siteRegistry));
rec('siteRegistry.impl', await implOf(A.siteRegistry));
rec('domainBinding.codeSize', await codeSize(A.domainBinding));
rec('domainBinding.impl', await implOf(A.domainBinding));
rec('domainBinding.monthlyFee(OKB)', formatEther(await read(A.domainBinding, 'monthlyFee')));

// ---- RPC behaviour the app depends on
const tryRpc = async (label, fn) => { try { rec(label, await fn()); } catch (e) { rec(label, `error: ${(e.shortMessage || e.details || e.message).split('\n')[0].slice(0, 160)}`); } };
const head = block.number;
for (const span of [100n, 1000n, 10000n]) {
  await tryRpc(`eth_getLogs over ${span} blocks`, async () => (await pub.getLogs({ address: A.factory, fromBlock: head - span, toBlock: head })).length + ' logs');
}
await tryRpc('eth_simulateV1 on rpc.xlayer.tech', async () => { const r = await pub.request({ method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls: [{ to: A.factory, data: '0xa94da8a7' }] }] }, 'latest'] }); return r[0].calls[0].status; });
await tryRpc('eth_call with state override (balance)', async () => { const r = await pub.call({ account: '0x000000000000000000000000000000000000bEEF', to: A.factory, data: '0xa94da8a7', stateOverride: [{ address: '0x000000000000000000000000000000000000bEEF', balance: 10n ** 18n }] }); return r.data; });
await tryRpc('historical state (head-2000) available', async () => (await pub.readContract({ address: A.factory, abi, functionName: 'cpuCount', blockNumber: head - 2000n })).toString());
await tryRpc('historical state (head-200000) available', async () => (await pub.readContract({ address: A.factory, abi, functionName: 'cpuCount', blockNumber: head - 200000n })).toString());

fs.mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../out/verify-chain.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
const failed = out.checks.filter((c) => !c.ok);
console.log(`\n${out.checks.length} checks, ${failed.length} failed`);
if (failed.length) process.exit(1);
