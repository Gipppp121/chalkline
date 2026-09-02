// A charter declares, per seat, what that seat may change.
// It is a declaration you write. stopline does not infer one for you.

import { readFileSync } from 'node:fs';

export const CATEGORIES = [
  'lint', 'test', 'docs', 'config', 'lockfile',
  'logic', 'delete', 'rename', 'binary', 'secret',
];

export function loadCharter(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`no charter at ${path}. A seat with no charter has no stopline; write one before gating on it.`);
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new Error(`charter at ${path} is not valid JSON: ${e.message}`);
  }

  if (!doc.seats || typeof doc.seats !== 'object') {
    throw new Error('charter has no "seats" object');
  }

  for (const [name, seat] of Object.entries(doc.seats)) {
    if (!Array.isArray(seat.may_change)) {
      throw new Error(`seat "${name}" has no may_change array`);
    }
    const bad = seat.may_change.filter(c => !CATEGORIES.includes(c));
    if (bad.length) {
      throw new Error(`seat "${name}" allows unknown categories: ${bad.join(', ')}`);
    }
    if (seat.may_touch && !Array.isArray(seat.may_touch)) {
      throw new Error(`seat "${name}": may_touch must be an array of globs`);
    }
    if (seat.never && !Array.isArray(seat.never)) {
      throw new Error(`seat "${name}": never must be an array of globs`);
    }
    for (const k of ['max_files', 'max_lines']) {
      if (seat[k] !== undefined && (!Number.isInteger(seat[k]) || seat[k] < 1)) {
        throw new Error(`seat "${name}": ${k} must be a positive integer`);
      }
    }
    if (seat.may_change.includes('secret')) {
      throw new Error(`seat "${name}" allows "secret". No seat may be chartered to change a credential; remove it and handle those by hand.`);
    }
  }

  return doc;
}

export function getSeat(charter, name) {
  const seat = charter.seats[name];
  if (!seat) {
    const known = Object.keys(charter.seats).join(', ') || '(none)';
    throw new Error(`no seat named "${name}" in the charter. Declared seats: ${known}`);
  }
  return seat;
}
