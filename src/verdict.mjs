// Applies a seat's charter to a classified diff.
// Three verdicts. The middle one is the one that matters.

import { matchesAny } from './diff.mjs';
import { classify } from './classify.mjs';

export function judge(files, seat, seatName) {
  const rows = [];

  for (const file of files) {
    const { category, notes } = classify(file);
    const reasons = [];

    if (seat.never && matchesAny(file.path, seat.never)) {
      reasons.push(`path is on this seat's never list`);
    }
    if (seat.may_touch && seat.may_touch.length && !matchesAny(file.path, seat.may_touch)) {
      reasons.push(`path is outside may_touch`);
    }
    if (!seat.may_change.includes(category)) {
      reasons.push(`category "${category}" is not in may_change`);
    }

    rows.push({
      path: file.path,
      category,
      status: file.status,
      hunks: file.hunks,
      lines: file.added.length + file.removed.length,
      crossed: reasons.length > 0,
      reasons,
      notes,
    });
  }

  // Size limits are a property of the patch as a whole, not of one file.
  // A patch that is inside every category but ten times the size a seat
  // normally produces is a different kind of event, and it stops here too.
  const scale = [];
  const totalLines = rows.reduce((n, r) => n + r.lines, 0);
  if (seat.max_files !== undefined && rows.length > seat.max_files) {
    scale.push(`${rows.length} files changed; this seat's charter allows ${seat.max_files}`);
  }
  if (seat.max_lines !== undefined && totalLines > seat.max_lines) {
    scale.push(`${totalLines} lines changed; this seat's charter allows ${seat.max_lines}`);
  }

  const crossed = rows.filter(r => r.crossed);
  const uncertain = rows.filter(r => r.notes.length > 0 && !r.crossed);

  let verdict;
  if (crossed.length || scale.length) verdict = 'refused';
  else if (uncertain.length) verdict = 'held';
  else if (rows.length === 0) verdict = 'held';
  else verdict = 'allowed';

  return { seat: seatName, verdict, rows, crossed, uncertain, scale, totalLines };
}
