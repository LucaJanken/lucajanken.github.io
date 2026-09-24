// Node runner:  node solar-system/tests/run.mjs   (Node 18+, no dependencies)
import { readFileSync } from 'node:fs';
import { runAll } from './checks.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/horizons.json', import.meta.url)));
const t0 = Date.now();
const results = runAll(fixture);
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
