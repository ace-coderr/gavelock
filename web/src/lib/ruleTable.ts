import type { Address } from 'viem';
import { readTruthTable, type TableRead } from './rules.ts';

// A rule's table never changes once taped out, so each is read once per page load and shared.
const cache = new Map<string, Promise<TableRead>>();
const progress = new Map<string, number>();
const listeners = new Map<string, Set<(done: number) => void>>();

export function ruleTable(processor: Address, id: number, onProgress?: (done: number) => void): Promise<TableRead> {
  const key = `${processor}:${id}`;
  if (onProgress) {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(onProgress);
    const known = progress.get(key);
    if (known !== undefined) onProgress(known);
  }
  let p = cache.get(key);
  if (!p) {
    p = readTruthTable(processor, id, (done) => {
      progress.set(key, done);
      listeners.get(key)?.forEach((fn) => fn(done));
    });
    p.catch(() => cache.delete(key)); // a failed read can be tried again
    cache.set(key, p);
  }
  return p;
}
