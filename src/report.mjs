// The evidence block. Every line here traces to a row in the diff.
// Nothing is summarised into a number that hides which file caused it.

const PAD = (s, n) => String(s).padEnd(n);

export function renderText(result, { charterPath }) {
  const L = [];
  const head = {
    allowed: 'ALLOWED',
    held: 'HELD',
    refused: 'REFUSED',
  }[result.verdict];

  L.push(`${head}  seat "${result.seat}"  ${result.rows.length} file(s) changed`);
  L.push('');

  if (result.rows.length === 0) {
    L.push('  the diff contains no file changes stopline could read.');
    L.push('  an empty diff is not an approved diff. nothing was checked.');
    return L.join('\n');
  }

  const w = Math.min(52, Math.max(12, ...result.rows.map(r => r.path.length)));
  L.push(`  ${PAD('FILE', w)}  ${PAD('CATEGORY', 10)} ${PAD('LINES', 6)} STOPLINE`);
  for (const r of result.rows) {
    const mark = r.crossed ? 'crossed' : (r.notes.length ? 'unclear' : 'inside');
    L.push(`  ${PAD(r.path.slice(0, w), w)}  ${PAD(r.category, 10)} ${PAD(r.lines, 6)} ${mark}`);
  }
  L.push('');

  if (result.scale && result.scale.length) {
    L.push('  crossed on scale:');
    for (const r of result.scale) L.push(`    ! ${r}`);
    L.push('');
  }

  if (result.crossed.length) {
    L.push('  crossed the stopline:');
    for (const r of result.crossed) {
      for (const reason of r.reasons) L.push(`    ! ${r.path}: ${reason}`);
    }
    L.push('');
  }

  if (result.uncertain.length) {
    L.push('  could not be classified with confidence:');
    for (const r of result.uncertain) {
      for (const n of r.notes) L.push(`    ? ${r.path}: ${n}`);
    }
    L.push('');
  }

  if (result.verdict === 'refused') {
    L.push('  This patch is not inside what the seat was chartered to change.');
    L.push('  chalkline does not judge whether the patch is correct. Only whether');
    L.push('  it stayed where it said it would.');
  } else if (result.verdict === 'held') {
    L.push('  Held, not refused: nothing crossed, but something could not be read');
    L.push('  well enough to say it stayed inside. A person decides this one.');
  } else {
    L.push('  Every changed file is inside the charter for this seat.');
    L.push('  That is not a statement that the change is good.');
  }

  L.push('');
  L.push(`  charter: ${charterPath}`);
  return L.join('\n');
}

// GitHub workflow annotations: refusals land on the PR diff itself,
// next to the file that caused them, instead of only in a log nobody opens.
export function renderGithub(result) {
  const L = [];
  for (const r of result.crossed) {
    for (const reason of r.reasons) {
      L.push(`::error file=${r.path},title=chalkline (${result.seat})::${reason}`);
    }
  }
  for (const r of result.uncertain) {
    for (const n of r.notes) {
      L.push(`::warning file=${r.path},title=chalkline (${result.seat})::${n}`);
    }
  }
  for (const s of (result.scale || [])) {
    L.push(`::error title=chalkline (${result.seat})::${s}`);
  }
  if (!L.length) L.push(`::notice title=chalkline (${result.seat})::every changed file is inside the charter`);
  return L.join('\n');
}

// Prints a seat's charter as prose. No diff involved: this answers
// "what is this seat even allowed to do" before anything has run.
export function renderExplain(seatName, seat) {
  const L = [];
  L.push(`seat "${seatName}"`);
  if (seat.stopline) L.push(`  ${seat.stopline}`);
  L.push('');
  L.push(`  may change:  ${seat.may_change.join(', ')}`);
  if (seat.may_touch && seat.may_touch.length) L.push(`  may touch:   ${seat.may_touch.join(', ')}`);
  else L.push('  may touch:   any path (no may_touch declared)');
  if (seat.never && seat.never.length) L.push(`  never:       ${seat.never.join(', ')}`);
  if (seat.max_files !== undefined) L.push(`  max files:   ${seat.max_files} per patch`);
  if (seat.max_lines !== undefined) L.push(`  max lines:   ${seat.max_lines} per patch`);
  L.push('');
  const cannot = ['logic', 'secret', 'delete', 'rename', 'binary', 'lockfile', 'config', 'docs', 'test', 'lint']
    .filter(c => !seat.may_change.includes(c));
  L.push(`  cannot produce: ${cannot.join(', ')}`);
  L.push('');
  L.push('  A patch inside all of the above is not thereby correct.');
  L.push('  This says what the seat is permitted to change, nothing more.');
  return L.join('\n');
}

export function renderJson(result, { charterPath }) {
  return JSON.stringify({
    seat: result.seat,
    verdict: result.verdict,
    charter: charterPath,
    files: result.rows,
    scale: result.scale || [],
    total_lines: result.totalLines,
    limits: {
      reads: 'the textual diff only',
      does_not_read: 'intent, correctness, test results, or runtime behaviour',
      lint_detection: 'whitespace-normalised line equality; refused for whitespace-sensitive languages',
    },
  }, null, 2);
}
