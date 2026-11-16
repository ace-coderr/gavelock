// Browser version of the tlock check. Bundled to one file with no external scripts and run from localhost.
import { timelockEncrypt, timelockDecrypt, roundAt, roundTime, mainnetClient, Buffer } from 'tlock-js';

const el = document.getElementById('result');
const out = { userAgent: navigator.userAgent, steps: [] };
const show = () => { el.textContent = JSON.stringify(out, null, 2); };
const step = (name, value) => { out.steps.push({ name, value }); show(); };

(async () => {
  try {
    const client = mainnetClient();
    const info = await client.chain().info();
    step('chain info fetched from the browser', { hash: info.hash, period: info.period });
    const bytes = new Uint8Array(448);
    crypto.getRandomValues(bytes);
    const round = roundAt(Date.now() + 9000, info);
    let t = performance.now();
    const armored = await timelockEncrypt(round, Buffer.from(bytes), client);
    step('sealed', { round, ms: Math.round(performance.now() - t), armoredChars: armored.length });
    let early;
    try { await timelockDecrypt(armored, client); early = 'DECRYPTED EARLY'; } catch (e) { early = `refused: ${String(e.message).slice(0, 80)}`; }
    step('open before the round', early);
    const wait = roundTime(info, round) - Date.now() + 1500;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    t = performance.now();
    const opened = await timelockDecrypt(armored, client);
    const same = opened.length === bytes.length && opened.every((b, i) => b === bytes[i]);
    step('open after the round', { matches: same, ms: Math.round(performance.now() - t) });
    out.ok = same && early !== 'DECRYPTED EARLY';
  } catch (e) {
    out.ok = false; out.error = String(e && e.stack ? e.stack : e).slice(0, 600);
  }
  out.done = true; show();
})();
