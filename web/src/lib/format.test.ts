import { describe, expect, it } from 'vitest';
import { formatAge, formatGwei, formatInteger, shortAddress } from './format.ts';

describe('format', () => {
  it('formats gas prices seen on X Layer', () => {
    expect(formatGwei(20_000_001n)).toBe('0.02');
    expect(formatGwei(1_000_000_000n)).toBe('1');
    expect(formatGwei(1_500_000_000n)).toBe('1.5');
    expect(formatGwei(0n)).toBe('0');
  });

  it('formats counts', () => {
    expect(formatInteger(76049935n)).toBe('76,049,935');
    expect(formatInteger(424)).toBe('424');
  });

  it('shortens addresses', () => {
    expect(shortAddress('0x1f09daefa827f02cbb40967cc91b259763760761')).toBe('0x1f09…0761');
  });

  it('formats ages', () => {
    expect(formatAge(3)).toBe('3 s ago');
    expect(formatAge(125)).toBe('2 min ago');
    expect(formatAge(7300)).toBe('2 h ago');
    expect(formatAge(-1)).toBe('just now');
  });
});
