// Read-only: the token the factory now charges the processor fee in, and what recent creators paid.
import { createPublicClient, http, parseAbi, formatUnits, decodeEventLog, encodeFunctionData, parseAbiItem } from 'viem';
import { xLayer } from 'viem/chains';
import fs from 'node:fs';

const pub = createPublicClient({ chain: xLayer, transport: http('https://rpc.xlayer.tech', { retryCount: 3, retryDelay: 1200 }) });
const factory = '0x1f09daefa827f02cbb40967cc91b259763760761';
const abi = parseAbi([
  'function bem() view returns (address)', 'function deployFee() view returns (uint256)', 'function protocolFee() view returns (uint256)',
  'function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
  'function owner() view returns (address)', 'function protocolWallet() view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address, address)',
  'function mint(uint256 id, uint256 amount) payable',
  'function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)',
  'function transistors() view returns (address)', 'function TAPEOUT_FEE() view returns (uint256)',
]);
const out = {};
const t = async (fn) => { try { return await fn(); } catch (e) { return `error: ${(e.shortMessage || e.details || e.message).split('\n')[0].slice(0, 140)}`; } };
const bem = await pub.readContract({ address: factory, abi, functionName: 'bem' });
const [name, symbol, decimals, supply] = await Promise.all(['name', 'symbol', 'decimals', 'totalSupply'].map((f) => t(() => pub.readContract({ address: bem, abi, functionName: f }))));
const deployFee = await pub.readContract({ address: factory, abi, functionName: 'deployFee' });
const protocolFee = await pub.readContract({ address: factory, abi, functionName: 'protocolFee' });
Object.assign(out, { bem, name, symbol, decimals, totalSupply: supply.toString(), deployFeeUnits: deployFee.toString(), deployFee: formatUnits(deployFee, decimals), factoryProtocolFeeUnits: protocolFee.toString() });
console.log(out);
console.log('bem code bytes', ((await pub.getCode({ address: bem })).length - 2) / 2, 'owner', await t(() => pub.readContract({ address: bem, abi, functionName: 'owner' })));

// What the most recent creator actually paid.
const hash = '0x7a89ee5bff4e313e6c8f23eb1e0252bb07198a30cb676d42efee55bb8af1637a';
const rc = await pub.getTransactionReceipt({ hash });
for (const l of rc.logs) {
  if (l.address.toLowerCase() !== bem.toLowerCase()) continue;
  try { const e = decodeEventLog({ abi, data: l.data, topics: l.topics }); console.log('BEM log in creation tx:', e.eventName, e.args.from, '->', e.args.to, formatUnits(e.args.value, decimals), symbol); out.lastCreationPaid = { from: e.args.from, to: e.args.to, units: e.args.value.toString() }; } catch { console.log('BEM log (other)', l.topics[0]); }
}
console.log('creator BEM balance now', formatUnits(await pub.readContract({ address: bem, abi, functionName: 'balanceOf', args: [rc.from] }), decimals));

// Simulate: a fresh address with BEM balance and allowance set by state override is not possible without the
// storage layout, so instead replay from the last real creator (who may still hold BEM and an allowance).
const story = 'Gavelock: tamper-proof tenders. Every scoring rule is a circuit taped out here.';
console.log('last creator allowance to factory', (await pub.readContract({ address: bem, abi, functionName: 'allowance', args: [rc.from, factory] })).toString());
const sim = await t(() => pub.call({ account: rc.from, to: factory, data: encodeFunctionData({ abi, functionName: 'createCPU', args: ['Gavelock', 'GAVEL', story, 100_000_000n, 0n] }) }));
console.log('createCPU simulated from the last creator (value 0):', typeof sim === 'string' ? sim : `OK ${sim.data.slice(0, 140)}`);

// When did the fee switch? Compare the fee and the implementation at a few past blocks.
const head = await pub.getBlockNumber();
const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const history = [];
for (const back of [0n, 10_000n, 100_000n, 300_000n, 600_000n, 1_000_000n, 1_500_000n, 2_000_000n, 3_000_000n]) {
  const blockNumber = head - back;
  const impl = await t(async () => `0x${(await pub.getStorageAt({ address: factory, slot, blockNumber })).slice(26)}`);
  const fee = await t(async () => (await pub.readContract({ address: factory, abi, functionName: 'deployFee', blockNumber })).toString());
  const b = await t(async () => new Date(Number((await pub.getBlock({ blockNumber })).timestamp) * 1000).toISOString().slice(0, 16));
  history.push({ block: Number(blockNumber), time: b, impl, deployFee: fee });
}
console.table(history);
out.history = history;

// Is there a market for the token? Look at holders we can name: the factory, the protocol wallet.
const pw = await t(() => pub.readContract({ address: factory, abi, functionName: 'protocolWallet' }));
console.log('protocolWallet', pw, 'BEM', typeof pw === 'string' && pw.startsWith('0x') ? formatUnits(await pub.readContract({ address: bem, abi, functionName: 'balanceOf', args: [pw] }), decimals) : '-');
console.log('factory BEM', formatUnits(await pub.readContract({ address: bem, abi, functionName: 'balanceOf', args: [factory] }), decimals));
// Recent BEM transfers (last 100 blocks windows x 30) to see how actively it moves.
const ev = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
let n = 0; const sample = [];
for (let to = head, k = 0; k < 30; k++, to -= 101n) {
  const logs = await t(() => pub.getLogs({ address: bem, event: ev, fromBlock: to - 100n, toBlock: to }));
  if (Array.isArray(logs)) { n += logs.length; for (const l of logs.slice(0, 3)) if (sample.length < 12) sample.push({ block: Number(l.blockNumber), from: l.args.from, to: l.args.to, value: formatUnits(l.args.value, decimals) }); }
}
console.log(`BEM transfers in the last ~3,000 blocks: ${n}`); console.table(sample);
out.recentTransfers = n; out.sample = sample;
fs.mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../out/probe-bem.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
