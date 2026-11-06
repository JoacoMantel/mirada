// Predice qué letras o palabras conviene mostrar según lo que ya se escribió.
import { WORDS } from './words.js';

const ALPHABET = 'abcdefghijklmnñopqrstuvwxyz';
export const SPACE = ' ';

export function normalize(s) {
  return s.toLowerCase()
    .replace(/ñ/g, '\u0001')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ');
}

export class Predictor {
  constructor(data = WORDS) {
    const byKey = new Map();
    for (const group of data.split(';')) {
      const [zipf, list] = group.split(':');
      const weight = 10 ** Number(zipf);
      for (const form of list.split(' ')) {
        const key = normalize(form);
        const e = byKey.get(key);
        if (!e) byKey.set(key, { key, form, best: weight, weight });
        else {
          e.weight += weight;
          if (weight > e.best) { e.best = weight; e.form = form; }
        }
      }
    }
    this.entries = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    this.bigrams = new Map();
    for (const { key, weight } of this.entries) {
      for (let i = 1; i < key.length; i++) {
        const prev = key[i - 1];
        if (!this.bigrams.has(prev)) this.bigrams.set(prev, new Map());
        const m = this.bigrams.get(prev);
        m.set(key[i], (m.get(key[i]) || 0) + weight);
      }
    }
  }

  // Índice de la primera entrada que es >= prefijo.
  lowerBound(prefix) {
    let lo = 0, hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.entries[mid].key < prefix) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  currentPrefix(text) {
    const m = text.match(/[a-záéíóúüñ]+$/i);
    return m ? normalize(m[0]) : '';
  }

  // Todas las letras, de la más probable a la menos probable.
  rankedLetters(text) {
    const prefix = this.currentPrefix(text);
    const scores = new Map();
    for (let i = this.lowerBound(prefix); i < this.entries.length; i++) {
      const e = this.entries[i];
      if (!e.key.startsWith(prefix)) break;
      if (e.key === prefix) continue;
      const ch = e.key[prefix.length];
      scores.set(ch, (scores.get(ch) || 0) + e.weight);
    }
    const total = [...scores.values()].reduce((a, b) => a + b, 0) || 1;
    for (const [ch, w] of scores) scores.set(ch, w / total);
    const bi = prefix ? this.bigrams.get(prefix[prefix.length - 1]) : null;
    if (bi) {
      const biTotal = [...bi.values()].reduce((a, b) => a + b, 0) || 1;
      for (const [ch, w] of bi) scores.set(ch, (scores.get(ch) || 0) + 0.03 * w / biTotal);
    }
    return [...ALPHABET].sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0));
  }

  // Devuelve hasta `slots` opciones: letras en orden alfabético y, después, palabras completas.
  options(text, slots = 4) {
    const prefix = this.currentPrefix(text);
    const letterW = new Map();
    const matches = [];
    let total = 0, exact = 0;
    for (let i = this.lowerBound(prefix); i < this.entries.length; i++) {
      const e = this.entries[i];
      if (!e.key.startsWith(prefix)) break;
      total += e.weight;
      if (e.key === prefix) { exact = e.weight; continue; }
      matches.push(e);
      const ch = e.key[prefix.length];
      letterW.set(ch, (letterW.get(ch) || 0) + e.weight);
    }

    // Respaldo para nombres propios o palabras fuera de la lista.
    const scores = new Map();
    const lexTotal = [...letterW.values()].reduce((a, b) => a + b, 0) || 1;
    for (const [ch, w] of letterW) scores.set(ch, w / lexTotal);
    const bi = prefix ? this.bigrams.get(prefix[prefix.length - 1]) : null;
    if (bi) {
      const biTotal = [...bi.values()].reduce((a, b) => a + b, 0) || 1;
      const k = matches.length ? 0.03 : 1;
      for (const [ch, w] of bi) scores.set(ch, (scores.get(ch) || 0) + k * w / biTotal);
    }
    for (const ch of ALPHABET) if (!scores.has(ch)) scores.set(ch, 1e-6);

    const words = [];
    if (prefix && total > 0) {
      const ranked = matches
        .filter((e) => e.key.length >= prefix.length + 2)
        .sort((a, b) => b.weight - a.weight);
      for (const e of ranked.slice(0, 2)) {
        const p = e.weight / total;
        if (p >= (prefix.length >= 2 ? 0.1 : 0.3)) words.push({ kind: 'word', form: e.form, p });
      }
    }

    const letterSlots = Math.max(slots - words.length, 2);
    const candidates = [...scores.entries()].map(([ch, w]) => ({ kind: 'letter', ch, w }));
    if (prefix) {
      const spaceW = total ? exact / total : 0;
      candidates.push({ kind: 'space', ch: SPACE, w: spaceW || (prefix.length >= 3 ? 0.02 : 0) });
    }
    candidates.sort((a, b) => b.w - a.w);
    const picked = candidates.slice(0, letterSlots);
    const letters = picked.filter((c) => c.kind === 'letter').sort((a, b) => a.ch.localeCompare(b.ch, 'es'));
    const space = picked.filter((c) => c.kind === 'space');
    return [...letters, ...space, ...words.slice(0, slots - letterSlots)];
  }

  // Al terminar una palabra, recupera los acentos: "esta" queda igual, "mas" pasa a "más".
  bestForm(word) {
    const key = normalize(word);
    const i = this.lowerBound(key);
    const e = this.entries[i];
    return e && e.key === key ? e.form : word;
  }

  applySpace(text) {
    const m = text.match(/[a-záéíóúüñ]+$/i);
    if (!m) return text.endsWith(' ') || !text ? text : text + ' ';
    return text.slice(0, -m[0].length) + this.bestForm(m[0]) + ' ';
  }

  applyWord(text, form) {
    const m = text.match(/[a-záéíóúüñ]+$/i);
    return (m ? text.slice(0, -m[0].length) : text) + form + ' ';
  }
}

export function pretty(text) {
  return text.replace(/(^\s*|[.?!¿¡]\s*)([a-záéíóúüñ])/g, (_, a, b) => a + b.toUpperCase());
}

// Grupos que se abren en hasta 4 partes hasta llegar a un elemento.
export function split(items, parts = 4) {
  if (items.length <= parts) return items;
  const out = [];
  let start = 0;
  for (let i = 0; i < parts; i++) {
    const size = Math.ceil((items.length - start) / (parts - i));
    const chunk = items.slice(start, start + size);
    start += size;
    out.push(chunk.length === 1 ? chunk[0] : { kind: 'group', items: chunk });
  }
  return out;
}

const char = (ch) => ({ kind: 'letter', ch });
const abc = (a, b) => a.localeCompare(b, 'es');

// Menú "Más": dos páginas con las letras que siguen en probabilidad y una última con todo lo demás.
export function morePages(predictor, text, shown) {
  const rest = predictor.rankedLetters(text).filter((ch) => !shown.includes(ch));
  const hasPrefix = !!predictor.currentPrefix(text);
  const needsSpace = hasPrefix && !shown.includes(SPACE);
  const first = rest.slice(0, needsSpace ? 3 : 4);
  const second = rest.slice(first.length, first.length + 4);
  const others = rest.slice(first.length + second.length).sort(abc).map(char);
  const signs = [
    ...[...'.,?¿!:'].map(char),
    ...[...'0123456789'].map(char),
    { kind: 'action', action: 'clear', label: 'Borrar todo' },
  ];
  const third = split(others, 3);
  const last = [...(Array.isArray(third) ? third : [third]),
    { kind: 'group', label: 'Signos y números', items: signs }];
  return [
    { items: [...first.sort(abc).map(char), ...(needsSpace ? [{ kind: 'space', ch: SPACE }] : [])], more: true },
    { items: second.sort(abc).map(char), more: true },
    { items: last, more: false },
  ];
}
