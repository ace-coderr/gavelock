// Read-only: who can still change the code Gavelock depends on, and since when; plus the per-transaction gas cap.
import { createPublicClient, http, parseAbi, toHex } from 'viem';
import { xLayer } from 'viem/chains';
import fs from 'node:fs';

const pub = createPublicClient({ chain: xLayer, transport: http('https://rpc.xlayer.tech', { retryCount: 3, retryDelay: 1200 }) });
const drpc = createPublicClient({ chain: xLayer, transport: http('https://xlayer.drpc.org', { retryCount: 2, retryDelay: 1500 }) });
const abi = parseAbi(['function owner() view returns (address)', 'function implementation() view returns (address)', 'function isSealed() view returns (bool)']);
const t = async (fn) => { try { return await fn(); } catch (e) { return `error: ${(e.shortMessage || e.details || e.message).split('\n')[0].slice(0, 140)}`; } };
const out = {};
const head = await pub.getBlockNumber();
const targets = {
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  circuitBeacon: '0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C',
  transistorBeaconOld: '0x1059Ad62cAbB6a6925bb65aA617300556c60A51B',
  transistorBeaconNew: '0x41cb2bfd1ccca8f505eedad0181eef44f1b9ce65',
};
const rows = [];
for (const back of [0n, 1_000_000n, 3_000_000n, 4_500_000n, 5_000_000n]) {
  const blockNumber = head - back;
  const row = { block: Number(blockNumber) };
  for (const [k, a] of Object.entries(targets)) row[`${k}.owner`] = await t(() => pub.readContract({ address: a, abi, functionName: 'owner', blockNumber }));
  row['circuitImpl'] = await t(() => pub.readContract({ address: targets.circuitBeacon, abi, functionName: 'implementation', blockNumber }));
  rows.push(row);
}
console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('0x') ? `${v.slice(0, 8)}…` : v]))));
out.ownership = rows;
out.factorySealed = await t(() => pub.readContract({ address: targets.factory, abi, functionName: 'isSealed' }));
// Who deployed the new transistor beacon, and does it share the owner-less pattern?
out.newBeaconCodeEqualsOld = (await pub.getCode({ address: targets.transistorBeaconNew })) === (await pub.getCode({ address: targets.transistorBeaconOld }));
console.log('factory sealed:', out.factorySealed, '| new transistor beacon has the same code as the old one:', out.newBeaconCodeEqualsOld);

// Per-transaction gas cap: simulate with validation on a node that supports eth_simulateV1.
const from = '0x000000000000000000000000000000000000bEEF';
const probe = '0x00000000000000000000000000000000000c0de1';
// The callee just stops: the question is only whether validation accepts the gas limit itself.
const burner = '0x00';
for (const gas of [16_000_000n, 17_000_000n, 30_000_000n, 100_000_000n, 200_000_000n]) {
  const r = await t(async () => {
    const res = await drpc.request({ method: 'eth_simulateV1', params: [{ blockStateCalls: [{ stateOverrides: { [from]: { balance: toHex(10n ** 20n) }, [probe]: { code: burner } }, calls: [{ from, to: probe, gas: toHex(gas), maxFeePerGas: toHex(100_000_000n) }] }], validation: true }, 'latest'] });
    const c = res[0].calls[0];
    return `${c.status === '0x1' ? 'ok' : 'failed'} gasUsed ${BigInt(c.gasUsed)}${c.error ? ` (${c.error.message})` : ''}`;
  });
  console.log(`simulate one transaction with gas limit ${gas}:`, r);
  out[`txGas${gas}`] = r;
}
// And the largest real transactions in recent blocks.
let maxGas = 0n; let maxTx = null;
for (let i = 0n; i < 40n; i++) {
  const b = await t(() => pub.getBlock({ blockNumber: head - i * 250n, includeTransactions: true }));
  if (typeof b === 'string') continue;
  for (const tx of b.transactions) if (tx.gas > maxGas && tx.type !== 'deposit' && tx.typeHex !== '0x7e') { maxGas = tx.gas; maxTx = tx.hash; }
}
out.largestRecentGasLimit = { gas: maxGas.toString(), tx: maxTx };
console.log('largest gas limit among sampled recent transactions:', out.largestRecentGasLimit);
fs.mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../out/verify-trust.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
