import type { ShoppingItem } from '../types';

/** Lower-cases, strips punctuation and simple plurals so "Bananas" matches "banana". */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
      if (w.length > 4 && /(ches|shes|xes|sses|oes)$/.test(w)) return w.slice(0, -2);
      if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
      return w;
    })
    .join(' ');
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function isLikelyDuplicate(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Same words in a different order ("milk full cream" / "full cream milk").
  if (x.split(' ').sort().join(' ') === y.split(' ').sort().join(' ')) return true;
  // Small typos on longer names only, so "rice" and "mice" stay distinct.
  const shortest = Math.min(x.length, y.length);
  if (shortest >= 9) return editDistance(x, y) <= 2;
  if (shortest >= 5) return editDistance(x, y) <= 1;
  return false;
}

/** Items still to buy (active or deferred) that look like the same product. */
export function findDuplicates(name: string, items: ShoppingItem[], ignoreId?: string): ShoppingItem[] {
  return items.filter(
    (i) => i.id !== ignoreId && i.status !== 'purchased' && isLikelyDuplicate(name, i.name),
  );
}
