// Parses unified diff into per-file change records.
// Deliberately small: it understands what `git diff` emits and nothing else.

const FILE_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

export function parseDiff(text) {
  const files = [];
  let cur = null;

  for (const raw of text.split('\n')) {
    const m = raw.match(FILE_RE);
    if (m) {
      cur = {
        path: m[2],
        oldPath: m[1],
        status: 'modified',
        added: [],
        removed: [],
        hunks: 0,
        binary: false,
      };
      files.push(cur);
      continue;
    }
    if (!cur) continue;

    if (raw.startsWith('new file mode')) cur.status = 'added';
    else if (raw.startsWith('deleted file mode')) cur.status = 'deleted';
    else if (raw.startsWith('rename from')) cur.status = 'renamed';
    else if (raw.startsWith('Binary files ')) cur.binary = true;
    else if (HUNK_RE.test(raw)) cur.hunks++;
    else if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    else if (raw.startsWith('+')) cur.added.push(raw.slice(1));
    else if (raw.startsWith('-')) cur.removed.push(raw.slice(1));
  }

  return files;
}

// Glob -> RegExp. Supports **, *, ?, and {a,b} alternation. No extglob.
export function globToRe(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** spans separators; **/ also matches zero directories
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
        else { out += '.*'; i += 1; }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) { out += '\\{'; continue; }
      const alts = glob.slice(i + 1, close).split(',').map(a => a.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
      out += '(?:' + alts.join('|') + ')';
      i = close;
    } else if ('.+^$()|[]\\'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp('^' + out + '$');
}

export function matchesAny(path, globs) {
  return (globs || []).some(g => globToRe(g).test(path));
}
