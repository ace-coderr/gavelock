// Read-only: how do processors created after the November 2026 factory upgrade mint and tape out?
// Looks at the newest live processor with activity and at its real transactions.
import { createPublicClient, http, parseAbi, formatUnits, formatEther, toFunctionSelector, decodeFunctionData } from 'viem';
import { xLayer } from 'viem/chains';
import fs from 'node:fs';

const pub = createPublicClient({ chain: xLayer, transport: http('https://rpc.xlayer.tech', { retryCount: 3, retryDelay: 1200 }) });
const factory = '0x1f09daefa827f02cbb40967cc91b259763760761';
const BEM = '0x60e62Efa9405d6873C5deaBD4E6CC91c25363952';
const circuits = process.env.CIRCUITS || '0x0f096F9669b082Df098Db16157Aeb848BD59d504'; // processor #423
const createdAt = BigInt(process.env.CREATED_AT || 76040253);
const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const abi = parseAbi([
  'function transistors() view returns (address)', 'function implementation() view returns (address)', 'function owner() view returns (address)',
  'function transistorBeacon() view returns (address)', 'function circuitBeacon() view returns (address)',
  'function mint(uint256 id, uint256 amount) payable', 'function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)',
  'function TAPEOUT_FEE() view returns (uint256)', 'function protocolFee() view returns (uint256)', 'function mintPrice() view returns (uint256)',
  'function bem() view returns (address)', 'function factory() view returns (address)',
]);
const t = async (fn) => { try { return await fn(); } catch (e) { return `error: ${(e.shortMessage || e.details || e.message).split('\n')[0].slice(0, 120)}`; } };
const slotAddr = async (address, slot) => `0x${(await pub.getStorageAt({ address, slot })).slice(26)}`;
const out = {};
const transistors = await pub.readContract({ address: circuits, abi, functionName: 'transistors' });

const known = ['mint(uint256,uint256)', 'mintPrice()', 'protocolFee()', 'supplyCap()', 'minted()', 'withdraw()', 'owed(address)', 'creator()', 'bem()', 'factory()', 'circuits()', 'burnFrom(address,uint256,uint256)', 'NAND()', 'LATCH()', 'cpuName()', 'cpuSymbol()', 'story()',
  'tapeout(bytes,uint32,uint32)', 'eval(uint256,bytes)', 'step(uint256,bytes,bytes)', 'netlist(uint256)', 'circuitInfo(uint256)', 'nextId()', 'TAPEOUT_FEE()', 'TREASURY()', 'sweepFees()', 'transistors()', 'beat(address,uint256,bytes)', 'tapeoutFee()', 'treasury()', 'protocolWallet()', 'mintFor(address,uint256,uint256)', 'mintWithBem(uint256,uint256)'];
for (const [label, proxy] of [['circuits', circuits], ['transistors', transistors]]) {
  const code = await pub.getCode({ address: proxy });
  const beaconSlot = await slotAddr(proxy, BEACON_SLOT);
  const implSlot = await slotAddr(proxy, IMPL_SLOT);
  // A beacon proxy with an immutable beacon keeps the address in its own bytecode.
  const embedded = [...code.matchAll(/73([0-9a-f]{40})/g)].map((m) => `0x${m[1]}`);
  let beacon = /^0x0+$/.test(beaconSlot) ? embedded[0] : beaconSlot;
  const impl = beacon ? await t(() => pub.readContract({ address: beacon, abi, functionName: 'implementation' })) : implSlot;
  const beaconOwner = beacon ? await t(() => pub.readContract({ address: beacon, abi, functionName: 'owner' })) : null;
  const implCode = typeof impl === 'string' && impl.startsWith('0x') ? await pub.getCode({ address: impl }) : '0x';
  const has = known.filter((s) => implCode.includes(toFunctionSelector(s).slice(2)));
  const sels = new Set(); for (const m of implCode.matchAll(/63([0-9a-f]{8})14(?:61|62)/g)) sels.add(`0x${m[1]}`);
  const unknown = [...sels].filter((s) => !known.some((k) => toFunctionSelector(k) === s));
  out[label] = { proxy, proxyCodeBytes: (code.length - 2) / 2, beaconSlot, implSlot, embedded, beacon, beaconOwner, impl, implCodeBytes: (implCode.length - 2) / 2, has, unknownSelectors: unknown };
  console.log(label, out[label]);
}
console.log('factory.transistorBeacon', await t(() => pub.readContract({ address: factory, abi, functionName: 'transistorBeacon' })), 'factory.circuitBeacon', await t(() => pub.readContract({ address: factory, abi, functionName: 'circuitBeacon' })));
console.log('circuits.TAPEOUT_FEE', await t(() => pub.readContract({ address: circuits, abi, functionName: 'TAPEOUT_FEE' })), 'transistors.protocolFee', await t(() => pub.readContract({ address: transistors, abi, functionName: 'protocolFee' })), 'transistors.bem', await t(() => pub.readContract({ address: transistors, abi, functionName: 'bem' })), 'circuits.bem', await t(() => pub.readContract({ address: circuits, abi, functionName: 'bem' })));

// Real transactions on this processor since it was created: every log either contract emitted.
const head = await pub.getBlockNumber();
const txs = new Map();
for (let from = createdAt; from <= head; from += 101n) {
  const to = from + 100n > head ? head : from + 100n;
  for (const address of [circuits, transistors]) {
    const logs = await t(() => pub.getLogs({ address, fromBlock: from, toBlock: to }));
    if (Array.isArray(logs)) for (const l of logs) txs.set(l.transactionHash, l.blockNumber);
  }
}
console.log(`${txs.size} transactions touched the processor`);
const seen = [];
for (const [hash, block] of [...txs].slice(0, 14)) {
  const [tx, rc] = await Promise.all([pub.getTransaction({ hash }), pub.getTransactionReceipt({ hash })]);
  let call = tx.input.slice(0, 10);
  try { const d = decodeFunctionData({ abi, data: tx.input }); call = `${d.functionName}(${d.functionName === 'tapeout' ? `${(d.args[0].length - 2) / 2} bytes, ${d.args[1]}, ${d.args[2]}` : d.args.join(', ')})`; } catch {}
  const bemMoves = rc.logs.filter((l) => l.address.toLowerCase() === BEM.toLowerCase() && l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef').map((l) => `${formatUnits(BigInt(l.data), 8)} BEM -> 0x${l.topics[2].slice(26, 34)}…`);
  const row = { block: Number(block), to: tx.to === circuits ? 'circuits' : tx.to === transistors ? 'transistors' : tx.to, call, valueOKB: formatEther(tx.value), gasUsed: Number(rc.gasUsed), bem: bemMoves.join('; ') || '-', status: rc.status };
  seen.push(row); console.log(row);
}
out.transactions = seen;
fs.mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../out/probe-new-cpu.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
