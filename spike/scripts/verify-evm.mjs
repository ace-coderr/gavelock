// Read-only probes of X Layer's EVM rules: opcode support, calldata pricing, code size limit,
// eth_call gas cap. Uses eth_call / eth_estimateGas with state overrides. Sends nothing.
import { createPublicClient, http, toHex } from 'viem';
import { xLayer } from 'viem/chains';
import fs from 'node:fs';

const pub = createPublicClient({ chain: xLayer, transport: http('https://rpc.xlayer.tech', { retryCount: 3, retryDelay: 1200 }) });
const out = [];
const rec = (k, v) => { out.push([k, typeof v === 'bigint' ? v.toString() : v]); console.log(`${k}: ${typeof v === 'bigint' ? v.toString() : JSON.stringify(v)}`); };
const t = async (fn) => { try { return await fn(); } catch (e) { return `error: ${(e.shortMessage || e.details || e.message).split('\n')[0].slice(0, 160)}`; } };
const probe = '0x00000000000000000000000000000000000c0de1';
const from = '0x000000000000000000000000000000000000bEEF';
const runCode = (code, data = '0x') => t(async () => (await pub.call({ account: from, to: probe, data, stateOverride: [{ address: probe, code }, { address: from, balance: 10n ** 18n }] })).data ?? '0x');

// Each snippet returns 32 bytes holding 1 when the opcode executed.
rec('PUSH0 (Shanghai)', await runCode('0x5f60015f5260205ff3'));                 // PUSH0; mstore(0,1); return
rec('MCOPY (Cancun)', await runCode('0x60015f5260205f60205e60206020f3'));       // mstore(0,1); mcopy(32,0,32); return(32,32)
rec('TSTORE/TLOAD (Cancun)', await runCode('0x60015f5d5f5c5f5260205ff3'));      // tstore(0,1); mstore(0,tload(0)); return
rec('BLOBBASEFEE (Cancun)', await runCode('0x4a5f5260205ff3'));
rec('BASEFEE', await runCode('0x485f5260205ff3'));
rec('PREVRANDAO', await runCode('0x445f5260205ff3'));
rec('SHA-256 precompile (0x02) on "abc"', await t(async () => (await pub.call({ to: '0x0000000000000000000000000000000000000002', data: '0x616263' })).data));
rec('BLS12-381 G1ADD precompile (0x0b) present', await t(async () => { const r = await pub.call({ to: '0x000000000000000000000000000000000000000b', data: `0x${'00'.repeat(256)}` }); return (r.data ?? '0x').length; }));

// Calldata pricing: estimate a plain transfer to an EOA carrying n non-zero bytes.
for (const n of [0, 1000, 24000, 100000]) {
  const data = `0x${'ab'.repeat(n)}`;
  const g = await t(() => pub.estimateGas({ account: from, to: '0x000000000000000000000000000000000000dEaD', data, stateOverride: [{ address: from, balance: 10n ** 18n }] }));
  rec(`intrinsic gas with ${n} non-zero calldata bytes`, typeof g === 'bigint' ? `${g} (${n ? ((Number(g) - 21000) / n).toFixed(2) : '-'} gas/byte)` : g);
}
// Largest single transaction the node will estimate (document chunk sizing).
for (const n of [120000, 131072, 200000, 500000]) {
  const g = await t(() => pub.estimateGas({ account: from, to: '0x000000000000000000000000000000000000dEaD', data: `0x${'ab'.repeat(n)}`, stateOverride: [{ address: from, balance: 10n ** 18n }] }));
  rec(`estimateGas with ${n} calldata bytes`, typeof g === 'bigint' ? g : g);
}
// eth_call gas cap: an infinite loop reports how much gas the node allowed.
// JUMPDEST; GAS; PUSH0; MSTORE; ... simplest: loop until out of gas, read cap from a bounded variant instead.
// Return GAS at entry: the gas the node gives a call with no explicit limit.
rec('gas available to eth_call (no limit given)', await t(async () => BigInt(await runCode('0x5a5f5260205ff3'))));
rec('gas available to eth_call (gas: 200M)', await t(async () => BigInt((await pub.call({ account: from, to: probe, gas: 200_000_000n, stateOverride: [{ address: probe, code: '0x5a5f5260205ff3' }, { address: from, balance: 10n ** 18n }] })).data)));
rec('gas available to eth_call (gas: 1000M)', await t(async () => BigInt((await pub.call({ account: from, to: probe, gas: 1_000_000_000n, stateOverride: [{ address: probe, code: '0x5a5f5260205ff3' }, { address: from, balance: 10n ** 18n }] })).data)));

// Contract size limit: CREATE with initcode that returns n bytes of runtime code; success returns a non-zero address.
// initcode: PUSH3 n; PUSH0; RETURN  (returns n zero bytes as runtime code = n STOP opcodes)
const creator = (n) => {
  const init = `62${n.toString(16).padStart(6, '0')}5ff3`; // 6 bytes
  // mstore(0, init<<(26*8)); create(0, 0, 6); mstore(0, addr); return(0,32)
  return `0x65${init}5f52600660 1a5ff05f5260205ff3`.replace(/\s/g, '');
};
for (const n of [24576, 24577, 49152]) {
  const r = await t(async () => (await pub.call({ account: from, to: probe, gas: 30_000_000n, stateOverride: [{ address: probe, code: creator(n) }, { address: from, balance: 10n ** 18n }] })).data);
  rec(`CREATE runtime of ${n} bytes`, typeof r === 'string' && r.startsWith('0x') && BigInt(r) !== 0n ? 'ok' : `rejected (${r})`);
}
const blk = await pub.getBlock();
rec('block', Number(blk.number));
rec('block gas limit', blk.gasLimit);
rec('blobGasUsed field present', blk.blobGasUsed !== undefined && blk.blobGasUsed !== null);
rec('client version', await t(() => pub.request({ method: 'web3_clientVersion' })));
// Block cadence
const older = await pub.getBlock({ blockNumber: blk.number - 1000n });
rec('avg block time over 1000 blocks (s)', (Number(blk.timestamp - older.timestamp) / 1000).toFixed(3));
fs.mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../out/verify-evm.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
