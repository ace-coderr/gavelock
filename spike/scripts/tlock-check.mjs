// tlock-js against drand quicknet from Node: seal a bid-sized payload to a round a few seconds ahead,
// show it cannot be opened early, then open it once the round is published.
import { timelockEncrypt, timelockDecrypt, roundAt, roundTime, mainnetClient, defaultChainInfo } from 'tlock-js';
import { encodeAbiParameters, keccak256, toHex, hexToBytes, bytesToHex } from 'viem';
import fs from 'node:fs';

const out = {};
const client = mainnetClient();
const info = await client.chain().info();
out.chain = { hash: info.hash, period: info.period, genesis: info.genesis_time, scheme: info.schemeID, sameAsDefault: info.hash === defaultChainInfo.hash };
console.log('drand chain', out.chain);

// A bid as the contract will commit to it: price, deliveryDays, compliance bitmask, note, salt.
const note = 'Delivery in two lots, first lot within 10 days. Warranty 24 months on all units. '.repeat(3).slice(0, 240);
const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
const plaintext = encodeAbiParameters(
  [{ type: 'uint256' }, { type: 'uint32' }, { type: 'uint32' }, { type: 'string' }, { type: 'bytes32' }],
  [1_250_000_00n, 21, 0b1011, note, salt],
);
out.plaintextBytes = (plaintext.length - 2) / 2;
out.commitment = keccak256(plaintext);

const deadline = Date.now() + 9000;
const round = roundAt(deadline, info);
out.round = round; out.roundTime = new Date(roundTime(info, round)).toISOString();
const t0 = Date.now();
const armored = await timelockEncrypt(round, Buffer.from(hexToBytes(plaintext)), client);
out.encryptMs = Date.now() - t0;
out.armoredChars = armored.length;
// The armor is base64 text; the binary age payload inside is what goes on chain.
const body = armored.split('\n').filter((l) => l && !l.startsWith('-----')).join('');
const binary = Buffer.from(body, 'base64');
out.binaryBytes = binary.length;
console.log(`plaintext ${out.plaintextBytes} bytes -> armored ${out.armoredChars} chars / binary ${out.binaryBytes} bytes, sealed to round ${round} (${out.roundTime}) in ${out.encryptMs} ms`);

let early;
try { await timelockDecrypt(armored, client); early = 'DECRYPTED EARLY'; } catch (e) { early = `refused: ${String(e.message).slice(0, 90)}`; }
out.earlyDecrypt = early;
console.log('decrypt before the round:', early);

const wait = roundTime(info, round) - Date.now() + 1500;
if (wait > 0) await new Promise((r) => setTimeout(r, wait));
// Rebuild the armor from the binary bytes alone, as the app will after reading them from the chain.
const rebuilt = `-----BEGIN AGE ENCRYPTED FILE-----\n${binary.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END AGE ENCRYPTED FILE-----\n`;
const t1 = Date.now();
const opened = await timelockDecrypt(rebuilt, client);
out.decryptMs = Date.now() - t1;
out.roundTrip = toHex(new Uint8Array(opened)) === plaintext;
out.commitmentMatches = keccak256(toHex(new Uint8Array(opened))) === out.commitment;
console.log(`decrypt after the round: ${out.roundTrip ? 'matches' : 'MISMATCH'} in ${out.decryptMs} ms; commitment check ${out.commitmentMatches}`);

// Far-future rounds: a deadline weeks away must be accepted.
const far = roundAt(Date.now() + 30 * 24 * 3600 * 1000, info);
const farCt = await timelockEncrypt(far, Buffer.from('x'), client);
out.farRound = { round: far, ok: farCt.length > 0 };
console.log('sealing to a round 30 days ahead:', out.farRound);

fs.mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../out/tlock-node.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
if (!out.roundTrip || early === 'DECRYPTED EARLY') process.exit(1);
