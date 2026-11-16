// Read-only: find where BEM trades on X Layer and what 0.1 BEM costs in OKB right now.
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { xLayer } from 'viem/chains';
import fs from 'node:fs';

const pub = createPublicClient({ chain: xLayer, transport: http('https://rpc.xlayer.tech', { retryCount: 3, retryDelay: 1200 }) });
const BEM = '0x60e62Efa9405d6873C5deaBD4E6CC91c25363952';
const abi = parseAbi([
  'function token0() view returns (address)', 'function token1() view returns (address)',
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function fee() view returns (uint24)', 'function liquidity() view returns (uint128)', 'function factory() view returns (address)',
  'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
]);
const t = async (fn) => { try { return await fn(); } catch { return null; } };
const r = (address, functionName, args = []) => t(() => pub.readContract({ address, abi, functionName, args }));
const candidates = ['0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A', '0x9070Bbe1C566F5d3743dC40b86CA47D1353f9b3b', '0x84Bd6C0431F2DB78615884416c5f9519D852D196', '0x26Dc8281B63E13973D65bdb591dF611544106886', '0x7c5bEE2a8091C3ef39072f64F18Fac913060AEaF', '0xcc96b656b6dff0B5318d53271b82B7E7183b95D2', '0x8C0503460D972CEE16Acd1bF7801B2048AA72A42', '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', '0x011fc2C7B80e59e20c6cF1d27a29729D125f5Bf4', '0x58eaD5b41Cfd3627791D439402dd65571c286484'];
const out = [];
for (const a of candidates) {
  const code = await pub.getCode({ address: a });
  const size = code ? (code.length - 2) / 2 : 0;
  const row = { address: a, codeBytes: size, bem: formatUnits(await r(BEM, 'balanceOf', [a]) ?? 0n, 8) };
  if (size) {
    const [t0, t1] = [await r(a, 'token0'), await r(a, 'token1')];
    if (t0 && t1) {
      const other = t0.toLowerCase() === BEM.toLowerCase() ? t1 : t0;
      const [sym, dec] = [await r(other, 'symbol'), await r(other, 'decimals')];
      row.pair = `${t0.toLowerCase() === BEM.toLowerCase() ? 'BEM' : sym}/${t1.toLowerCase() === BEM.toLowerCase() ? 'BEM' : sym}`;
      row.other = other; row.otherSymbol = sym; row.otherDecimals = dec;
      const res = await r(a, 'getReserves');
      const s0 = await r(a, 'slot0');
      if (res) {
        const [bemRes, othRes] = t0.toLowerCase() === BEM.toLowerCase() ? [res[0], res[1]] : [res[1], res[0]];
        row.kind = 'v2'; row.bemReserve = formatUnits(bemRes, 8); row.otherReserve = formatUnits(othRes, dec);
        row.priceOtherPerBem = Number(formatUnits(othRes, dec)) / Number(formatUnits(bemRes, 8));
      } else if (s0) {
        const p = (Number(s0[0]) / 2 ** 96) ** 2; // token1 per token0 in base units
        const bemIs0 = t0.toLowerCase() === BEM.toLowerCase();
        const human = bemIs0 ? p * 10 ** (8 - dec) : (1 / p) * 10 ** (8 - dec);
        row.kind = 'v3'; row.fee = await r(a, 'fee'); row.priceOtherPerBem = human;
        row.otherHeld = formatUnits(await r(other, 'balanceOf', [a]) ?? 0n, dec);
      }
    } else { row.name = await r(a, 'name'); row.symbol = await r(a, 'symbol'); }
  }
  out.push(row);
  console.log(row);
}
fs.mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../out/probe-bem-price.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
