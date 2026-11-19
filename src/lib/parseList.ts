import type { Unit } from '../types';

export interface ParsedLine {
  name: string;
  quantity: number;
  unit: Unit;
}

const UNIT_WORDS: Record<string, Unit> = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  l: 'L', lt: 'L', ltr: 'L', litre: 'L', litres: 'L', liter: 'L', liters: 'L',
  ml: 'ml', mls: 'ml',
  pack: 'packs', packs: 'packs', pk: 'packs', pkt: 'packs', packet: 'packs', packets: 'packs',
  bottle: 'bottles', bottles: 'bottles', btl: 'bottles',
  unit: 'units', units: 'units', x: 'units',
  // Containers count as plain units: "2 cartons of milk" is 2 × milk.
  carton: 'units', cartons: 'units', tin: 'units', tins: 'units', can: 'units', cans: 'units', jar: 'units', jars: 'units',
  bag: 'units', bags: 'units', box: 'units', boxes: 'units', tub: 'units', tubs: 'units', punnet: 'units', punnets: 'units',
  bunch: 'units', bunches: 'units', tray: 'units', trays: 'units', roll: 'units', rolls: 'units',
};
const UNIT_PATTERN = Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join('|');
const NUM = '(\\d+(?:[.,]\\d+)?)';
const LEADING = new RegExp(`^${NUM}\\s*(${UNIT_PATTERN})?\\s+(?:of\\s+)?(.+)$`, 'i');
const TRAILING = new RegExp(`^(.+?)[\\s,]+(?:x\\s*)?${NUM}\\s*(${UNIT_PATTERN})?$`, 'i');

const toNumber = (s: string) => Number(s.replace(',', '.'));
const tidy = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ').slice(0, 80);
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Reads one line of a typed or pasted list: "2 kg tomatoes", "500g mince",
 * "milk 2L", "eggs x12", "- bread". Lines without a number are quantity 1.
 */
export function parseLine(raw: string): ParsedLine | null {
  const line = raw
    .replace(/^\s*(?:[-*•–]|\[[ xX]?\]|\d+[.)])\s+/, '')
    .replace(/^\s*\[[ xX]?\]\s*/, '')
    .trim();
  if (!line || !/[a-z]/i.test(line)) return null;

  const lead = LEADING.exec(line);
  if (lead && toNumber(lead[1]) > 0) {
    return { name: tidy(lead[3]), quantity: toNumber(lead[1]), unit: UNIT_WORDS[(lead[2] ?? 'x').toLowerCase()] };
  }
  const trail = TRAILING.exec(line);
  if (trail && toNumber(trail[2]) > 0 && /[a-z]/i.test(trail[1])) {
    return { name: tidy(trail[1]), quantity: toNumber(trail[2]), unit: UNIT_WORDS[(trail[3] ?? 'x').toLowerCase()] };
  }
  return { name: tidy(line), quantity: 1, unit: 'units' };
}

export function parseList(text: string): ParsedLine[] {
  return text.split(/\r?\n|;/).map(parseLine).filter((l): l is ParsedLine => l !== null);
}

export function formatLine(l: ParsedLine): string {
  const q = Number(l.quantity.toFixed(2));
  if (l.unit === 'units') return q === 1 ? l.name : `${q} ${l.name}`;
  return `${q} ${l.unit} ${l.name}`;
}
