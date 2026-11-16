// Read-only: find the exact conditions under which createCPU succeeds on the live factory.
// eth_call only, with a balance override for the caller. Sends nothing.
import { createPublicClient, http, parseAbi, encodeFunctionData, decodeErrorResult, toFunctionSelector, hexToString } from 'viem';
import { xLayer } from 'viem/chains';

const pub = createPublicClient({ chain: xLayer, transport: http('https://rpc.xlayer.tech', { retryCount: 3, retryDelay: 1200 }) });
const factory = '0x1f09daefa827f02cbb40967cc91b259763760761';
const from = process.env.FROM || '0x000000000000000000000000000000000000bEEF';
const abi = parseAbi([
  'function createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address, address)',
  'function deployFee() view returns (uint256)',
  'error Error(string)',
]);
const fee = await pub.readContract({ address: factory, abi, functionName: 'deployFee' });
console.log('deployFee', fee);

async function attempt(label, args, value, blockNumber, account = from) {
  const data = encodeFunctionData({ abi, functionName: 'createCPU', args });
  try {
    const r = await pub.call({ account, to: factory, data, value, blockNumber, stateOverride: [{ address: account, balance: 10n ** 18n }] });
    console.log(`${label}: OK -> ${r.data?.slice(0, 140)}`);
    return true;
  } catch (e) {
    let raw;
    for (let c = e; c; c = c.cause) if (c.data !== undefined) raw = typeof c.data === 'object' ? c.data?.data ?? JSON.stringify(c.data) : c.data;
    let decoded = '';
    if (typeof raw === 'string' && raw.startsWith('0x08c379a0')) { try { decoded = decodeErrorResult({ abi, data: raw }).args[0]; } catch {} }
    console.log(`${label}: REVERT raw=${typeof raw === 'string' ? raw.slice(0, 202) : raw} ${decoded ? `reason="${decoded}"` : ''} | ${(e.details || e.shortMessage || '').split('\n')[0].slice(0, 120)}`);
    return false;
  }
}

const story = 'Gavelock: tamper-proof tenders. Every scoring rule is a circuit taped out here.';
const base = ['Gavelock', 'GAVEL', story, 100_000_000n, 0n];
await attempt('supply 1e8, price 0, value = fee', base, fee);
await attempt('supply 1e8, price 0, value = 0', base, 0n);
await attempt('supply 1e8, price 0, value = fee-1', base, fee - 1n);
await attempt('supply 1e8, price 0, value = 0.0066', base, 6600000000000000n);
for (const supply of [10_000n, 100_000n, 1_000_000n, 10_000_000n, 21_000_000n, 1_000_000_000n]) await attempt(`supply ${supply}, price 0, value = fee`, ['Gavelock', 'GAVEL', story, supply, 0n], fee);
for (const price of [1n, 10n ** 9n, 10n ** 12n, 10n ** 13n, 10n ** 14n]) await attempt(`supply 1e6, price ${price}, value = fee`, ['Gavelock', 'GAVEL', story, 1_000_000n, price], fee);
await attempt('short symbol/story', ['Gavelock', 'GAV', 'x', 1_000_000n, 0n], fee);
await attempt('empty story', ['Gavelock', 'GAVEL', '', 1_000_000n, 0n], fee);

// Replay the most recent successful creation (block 76,040,253) one block earlier and now.
const tx = await pub.getTransaction({ hash: '0x7a89ee5bff4e313e6c8f23eb1e0252bb07198a30cb676d42efee55bb8af1637a' });
const replay = async (label, blockNumber, account) => {
  try { const r = await pub.call({ account, to: factory, data: tx.input, value: tx.value, blockNumber, stateOverride: [{ address: account, balance: 10n ** 18n }] }); console.log(`${label}: OK ${r.data?.slice(0, 140)}`); }
  catch (e) { let raw; for (let c = e; c; c = c.cause) if (c.data !== undefined) raw = c.data; console.log(`${label}: REVERT ${typeof raw === 'string' ? raw.slice(0, 202) : JSON.stringify(raw)} | ${(e.details || '').slice(0, 120)}`); }
};
await replay('replay Forkcast tx, original sender, block-1', tx.blockNumber - 1n, tx.from);
await replay('replay Forkcast tx, original sender, latest', undefined, tx.from);
await replay('replay Forkcast tx, fresh sender, block-1', tx.blockNumber - 1n, from);
await replay('replay Forkcast tx, fresh sender, latest', undefined, from);
console.log('deployFee at that block - 1:', await pub.readContract({ address: factory, abi, functionName: 'deployFee', blockNumber: tx.blockNumber - 1n }));
// decode the Forkcast call arguments
const head = tx.input.slice(10);
const word = (i) => BigInt(`0x${head.slice(i * 64, i * 64 + 64)}`);
console.log('Forkcast args: supply', word(3), 'mintPrice', word(4), 'gas', tx.gas, 'nonce', tx.nonce);

// Which known selectors does the current factory implementation contain?
const impl = `0x${(await pub.getStorageAt({ address: factory, slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' })).slice(26)}`;
const code = await pub.getCode({ address: impl });
console.log('factory impl', impl, 'code bytes', (code.length - 2) / 2);
const sigs = ['createCPU(string,string,string,uint256,uint256)', 'deployFee()', 'protocolFee()', 'setFees(uint256,uint256)', 'setDeployFee(uint256)', 'setProtocolFee(uint256)', 'paused()', 'pause()', 'unpause()', 'whitelist(address)', 'allowed(address)', 'isAllowed(address)', 'creators(address)', 'createdBy(address)', 'cpuOf(address)', 'maxPerCreator()', 'seal()', 'isSealed()', 'upgradeToAndCall(address,bytes)', 'owner()', 'cpus(uint256)', 'cpuAt(uint256)', 'cpuCount()', 'isCPU(address)', 'nameTaken(bytes32)', 'nameUsed(string)', 'symbolUsed(string)', 'minSupply()', 'maxSupply()', 'cooldown()', 'lastCreated(address)', 'bem()', 'feeToken()', 'createCPUFor(address,string,string,string,uint256,uint256)'];
for (const s of sigs) if (code.includes(toFunctionSelector(s).slice(2))) console.log('  has', s, toFunctionSelector(s));
// Every PUSH4 that is followed by EQ/JUMPI-style dispatch: list candidate selectors for manual lookup.
const sels = new Set();
for (const m of code.matchAll(/63([0-9a-f]{8})14(?:61|62)/g)) sels.add(`0x${m[1]}`);
console.log('dispatch selectors', [...sels].join(' '));
// Revert strings embedded in the implementation.
const strings = new Set();
for (const m of code.slice(2).matchAll(/(?:[2-7][0-9a-f]){5,40}/g)) { const s = hexToString(`0x${m[0]}`); if (/^[\x20-\x7e]+$/.test(s) && /[a-z]{3}/.test(s)) strings.add(s); }
console.log('strings', [...strings].slice(0, 80));
