// Stable JSON encoding, shared by paging and integrity code without Native APIs.
export function canonical(value: unknown): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, stable(x)])) : v;
  return JSON.stringify(stable(value));
}
