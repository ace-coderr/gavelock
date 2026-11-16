// Compile the starter rules locally, check each against its truth table on all 2,048 inputs,
// and print gate counts. No network access.
import fs from 'node:fs';
import { RULES, truthTable, randomTable, compileBest, equivalent, encode } from './lib/rules.mjs';

const rows = [];
for (const [key, r] of Object.entries(RULES)) {
  const table = truthTable(r.fn);
  const c = compileBest(table);
  const eq = equivalent(c, table);
  rows.push({ key, name: r.name, gates: c.gates.length, netlistBytes: c.gates.length * 7, equivalent: eq.ok, order: c.order.join(' ') });
}
{
  const table = randomTable(7);
  const c = compileBest(table);
  rows.push({ key: 'random', name: 'Worst case: random 11-in / 5-out table', gates: c.gates.length, netlistBytes: c.gates.length * 7, equivalent: equivalent(c, table).ok, order: c.order.join(' ') });
}
console.table(rows);
fs.mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../out/rule-sizes.json', import.meta.url), JSON.stringify(rows, null, 2) + '\n');
if (rows.some((r) => !r.equivalent)) process.exit(1);
void encode;
