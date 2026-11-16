/** Thousands separators for a count or block number. */
export function formatInteger(value: bigint | number): string {
  return value.toLocaleString('en-US');
}

/** Wei per gas as gwei, without trailing zeros: 20000001 -> "0.02". */
export function formatGwei(wei: bigint, maxDecimals = 4): string {
  const scale = 10n ** 9n;
  const whole = wei / scale;
  const fraction = (wei % scale).toString().padStart(9, '0').slice(0, maxDecimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** 0x1234…cdef */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** "3 s ago", "2 min ago". */
export function formatAge(seconds: number): string {
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${Math.floor(seconds)} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
}
