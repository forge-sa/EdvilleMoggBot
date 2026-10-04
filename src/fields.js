import { config } from './config.js';
import { formatDate, parseDate, todayIso } from './dates.js';

// The things a card is made of. Every field knows how to parse user input,
// how to print itself and how to turn itself into a comparable string key
// (used to store and compare disagreement claims).
//
// `optional` fields (exams) can be answered with "not taken", stored as 0.
// `consensus` is how the community's claims become a suggested value: the
// median for things that can be ordered, the most common claim for names.

// "aruzhan" / "ARUZHAN" -> "Aruzhan"; mixed case like "McKay" is left alone.
const capitalize = (part) =>
  part === part.toLowerCase() || part === part.toUpperCase()
    ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    : part;

const NOT_TAKEN = /^(no|nope|none|-|—|нет|жоқ|not taken|didn'?t take( it)?)$/i;

const number = (text) => (/\d/.test(text) ? Number(text.trim().replace(',', '.')) : NaN);

export const FIELDS = {
  name: {
    label: 'Name',
    emoji: '👤',
    consensus: 'mode',
    ownQuestion: 'Your real <b>name</b>?',
    hint: () => 'Real first and last name, e.g. <code>Aruzhan Bekova</code>',
    parse(text) {
      const words = text.trim().split(/\s+/);
      const valid =
        words.length >= 2 &&
        words.length <= 4 &&
        words.join(' ').length <= 50 &&
        words.every((w) => /^\p{L}+(?:['’-]\p{L}+)*$/u.test(w));
      if (!valid) return { error: 'I need a real first and last name, letters only.' };
      return { value: words.map((w) => w.split('-').map(capitalize).join('-')).join(' ') };
    },
    format: (v) => v,
    toKey: (v) => v,
    fromKey: (k) => k,
  },

  grade: {
    label: 'Class',
    emoji: '🎓',
    consensus: 'median',
    ownQuestion: 'Which <b>class</b> are you in?',
    hint: () => 'A whole number from 1 to 11, e.g. <code>9</code>',
    parse(text) {
      const match = text.trim().match(/^(\d{1,2})\s*(st|nd|rd|th|grade|class)?$/i);
      const n = match && Number(match[1]);
      if (!n || n < 1 || n > 11) return { error: 'Class must be a whole number from 1 to 11.' };
      return { value: n };
    },
    format: (v) => String(v),
    toKey: (v) => String(v),
    fromKey: (k) => Number(k),
  },

  gpa: {
    label: 'GPA',
    emoji: '📚',
    consensus: 'median',
    hint: () => `A number from 0 to ${config.gpaMax}, e.g. <code>4.67</code>`,
    parse(text) {
      const n = number(text);
      if (!Number.isFinite(n) || n < 0 || n > config.gpaMax) {
        return { error: `GPA must be a number from 0 to ${config.gpaMax}.` };
      }
      return { value: Math.round(n * 100) / 100 };
    },
    format: (v) => v.toFixed(2),
    toKey: (v) => v.toFixed(2),
    fromKey: (k) => Number(k),
  },

  ielts: {
    label: 'IELTS',
    emoji: '📝',
    optional: true,
    consensus: 'median',
    ownQuestion: 'Have you passed <b>IELTS</b>? If yes, what was your overall band?',
    hint: () => 'A band from 1 to 9, e.g. <code>7.5</code>. Not taken: press the button or send <code>no</code>.',
    parse(text) {
      if (NOT_TAKEN.test(text.trim())) return { value: 0 };
      const n = number(text);
      if (!Number.isFinite(n) || n < 1 || n > 9 || (n * 2) % 1 !== 0) {
        return { error: 'An IELTS band is a number from 1 to 9 in steps of 0.5, e.g. 6.5.' };
      }
      return { value: n };
    },
    format: (v) => (v ? v.toFixed(1) : 'not taken'),
    toKey: (v) => v.toFixed(1),
    fromKey: (k) => Number(k),
  },

  sat: {
    label: 'SAT',
    emoji: '📐',
    optional: true,
    consensus: 'median',
    ownQuestion: 'Have you passed the <b>SAT</b>? If yes, what was your total score?',
    hint: () => 'A score from 400 to 1600, e.g. <code>1450</code>. Not taken: press the button or send <code>no</code>.',
    parse(text) {
      if (NOT_TAKEN.test(text.trim())) return { value: 0 };
      const n = number(text);
      if (!Number.isInteger(n) || n < 400 || n > 1600 || n % 10 !== 0) {
        return { error: 'A SAT score is a whole number from 400 to 1600 in steps of 10.' };
      }
      return { value: n };
    },
    format: (v) => (v ? String(v) : 'not taken'),
    toKey: (v) => String(v),
    fromKey: (k) => Number(k),
  },

  since: {
    label: 'In Edville since',
    emoji: '🏫',
    consensus: 'median',
    ownQuestion: 'When did you join <b>Edville</b>?',
    disputeQuestion: (name) => `When did ${name} really join <b>Edville</b>?`,
    hint: () => 'A date as <code>DD.MM.YYYY</code>, e.g. <code>01.09.2023</code>',
    parse(text) {
      const iso = parseDate(text);
      if (!iso) return { error: 'I need a real date in the form DD.MM.YYYY.' };
      if (iso < config.schoolOpened) {
        return { error: `Edville opened on ${formatDate(config.schoolOpened)}, nobody joined before that.` };
      }
      if (iso > todayIso()) return { error: "That date hasn't happened yet." };
      return { value: iso };
    },
    format: (v) => formatDate(v),
    toKey: (v) => v,
    fromKey: (k) => k,
  },
};

export const FIELD_ORDER = ['name', 'grade', 'gpa', 'ielts', 'sat', 'since'];

/** Turns the community's claims (keys, oldest first) into one suggested value. */
export function consensus(field, keys) {
  const def = FIELDS[field];
  if (def.consensus === 'mode') {
    const counts = new Map();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    // A Map iterates in insertion order, so a tie goes to the earliest claim.
    let best = keys[0];
    for (const [key, n] of counts) if (n > counts.get(best)) best = key;
    return def.fromKey(best);
  }
  // The lower median is always one of the actual claims, so a single troll
  // can't drag the value anywhere.
  const sorted = keys.map(def.fromKey).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}
