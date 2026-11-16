// Follow-up read-only checks: beacon ownership, fee values copied into the newest processors,
// log access by exact block, and which public nodes support eth_simulateV1. Sends nothing.
import { createPublicClient, http, parseAbi, formatEther, toFunctionSelector, parseAbiItem } from 'viem';
import { xLayer } from 'viem/chains';
import fs from 'node:fs';

const pub = createPublicClient({ chain: xLayer, transport: http('https://rpc.xlayer.tech', { retryCount: 4, retryDelay: 1200 }) });
const factory = '0x1f09daefa827f02cbb40967cc91b259763760761';
const abi = parseAbi([
  'function cpuCount() view returns (uint256)', 'function cpuAt(uint256) view returns (address)',
  'function owner() view returns (address)', 'function implementation() view returns (address)',
  'function transistors() view returns (address)', 'function protocolFee() view returns (uint256)',
  'function mintPrice() view returns (uint256)', 'function supplyCap() view returns (uint256)', 'function minted() view returns (uint256)',
  'function TAPEOUT_FEE() view returns (uint256)', 'function nextId() view returns (uint256)', 'function name() view returns (string)',
  'function creator() view returns (address)', 'function deployFee() view returns (uint256)',
]);
const out = [];
const rec = (k, v) => { out.push([k, typeof v === 'bigint' ? v.toString() : v]); console.log(`${k}: ${typeof v === 'bigint' ? v.toString() : JSON.stringify(v)}`); };
const t = async (fn) => { try { return await fn(); } catch (e) { return `error: ${(e.shortMessage || e.details || e.message).split('\n')[0].slice(0, 140)}`; } };
const read = (address, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

// Beacons: who can change the code behind every processor?
for (const [label, beacon] of [['circuitBeacon', '0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C'], ['transistorBeacon', '0x1059Ad62cAbB6a6925bb65aA617300556c60A51B']]) {
  const code = await pub.getCode({ address: beacon });
  rec(`${label}.codeSize`, (code.length - 2) / 2);
  rec(`${label}.owner()`, await t(() => read(beacon, 'owner')));
  for (const sig of ['upgradeTo(address)', 'owner()', 'transferOwnership(address)', 'renounceOwnership()', 'implementation()', 'factory()', 'setImplementation(address)']) {
    rec(`${label} has ${sig}`, code.includes(toFunctionSelector(sig).slice(2)));
  }
  for (let i = 0; i < 3; i++) rec(`${label}.slot${i}`, await pub.getStorageAt({ address: beacon, slot: `0x${i.toString(16)}` }));
}

// Fees as copied into the newest processors.
const n = await read(factory, 'cpuCount');
rec('cpuCount', n);
rec('factory.deployFee(wei)', await read(factory, 'deployFee'));
rec('factory.protocolFee(wei)', await read(factory, 'protocolFee'));
for (const i of [n - 1n, n - 2n, n - 20n, n - 60n, n - 120n, 0n]) {
  const c = await read(factory, 'cpuAt', [i]);
  const tr = await read(c, 'transistors');
  rec(`cpu #${i}`, {
    circuits: c, name: await t(() => read(c, 'name')),
    tapeoutFee: formatEther(await read(c, 'TAPEOUT_FEE')),
    mintProtocolFee: formatEther(await read(tr, 'protocolFee')),
    mintPrice: formatEther(await read(tr, 'mintPrice')),
    supplyCap: (await read(tr, 'supplyCap')).toString(), minted: (await read(tr, 'minted')).toString(),
    circuitsTaped: (await read(c, 'nextId')).toString(),
  });
}

// Logs by exact block, far in the past (the app needs this to recover tx hashes and document bytes).
const ev = parseAbiItem('event CPUCreated(address indexed circuits, address indexed transistors, address indexed creator, string name, uint256 supply, uint256 mintPrice)');
const head = await pub.getBlockNumber();
// Walk back in 100-block windows to find the most recent CPUCreated, then re-read that single block.
let found = null;
for (let to = head, k = 0; k < 400 && !found; k++, to -= 100n) {
  const logs = await t(() => pub.getLogs({ address: factory, event: ev, fromBlock: to - 99n, toBlock: to }));
  if (Array.isArray(logs) && logs.length) found = logs[logs.length - 1];
}
if (found) {
  rec('latest CPUCreated', { block: Number(found.blockNumber), tx: found.transactionHash, name: found.args.name, supply: found.args.supply.toString(), mintPrice: found.args.mintPrice.toString() });
  const tx = await pub.getTransaction({ hash: found.transactionHash });
  rec('that createCPU tx value (OKB)', formatEther(tx.value));
  const rc = await pub.getTransactionReceipt({ hash: found.transactionHash });
  rec('that createCPU gasUsed', rc.gasUsed);
  rec('that createCPU effectiveGasPrice(wei)', rc.effectiveGasPrice);
} else rec('latest CPUCreated', 'none in the last 40,000 blocks');
const oldBlock = 72516039n; // a block with a known transaction from early October 2026
rec('getLogs single old block (72,516,039)', await t(async () => `${(await pub.getLogs({ fromBlock: oldBlock, toBlock: oldBlock })).length} logs`));
rec('getLogs 100-block window, old', await t(async () => `${(await pub.getLogs({ address: factory, fromBlock: oldBlock - 50n, toBlock: oldBlock + 49n })).length} logs`));
rec('getLogs 101-block window', await t(async () => `${(await pub.getLogs({ address: factory, fromBlock: head - 100n, toBlock: head })).length} logs`));

// Other public nodes.
for (const url of ['https://xlayer.drpc.org', 'https://xlayerrpc.okx.com', 'https://rpc.ankr.com/xlayer', 'https://xlayer-rpc.publicnode.com']) {
  const c = createPublicClient({ chain: xLayer, transport: http(url, { retryCount: 1, timeout: 15000 }) });
  rec(`${url} chainId`, await t(() => c.getChainId()));
  rec(`${url} eth_simulateV1`, await t(async () => (await c.request({ method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls: [{ to: factory, data: '0xa94da8a7' }] }] }, 'latest'] }))[0].calls[0].status));
  rec(`${url} getLogs 1000 blocks`, await t(async () => `${(await c.getLogs({ address: factory, fromBlock: head - 1000n, toBlock: head })).length} logs`));
}
// CORS: can a browser on another origin call the public node?
for (const url of ['https://rpc.xlayer.tech', 'https://xlayer.drpc.org', 'https://xlayerrpc.okx.com']) {
  rec(`${url} CORS`, await t(async () => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://ace-coderr.github.io' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    return `status ${r.status}, allow-origin ${r.headers.get('access-control-allow-origin')}`;
  }));
}
fs.mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../out/verify-extra.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
