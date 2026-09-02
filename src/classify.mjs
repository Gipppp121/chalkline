// Classifies each changed file into one category.
// The classifier reads text. It does not read intent, and it says so.

import { matchesAny } from './diff.mjs';

// In these languages whitespace carries meaning, so a whitespace-only diff
// is not safely "formatting". We refuse to call it lint and fall through
// to the file's real category instead.
const WHITESPACE_SENSITIVE = ['.py', '.yaml', '.yml', '.coffee', '.haml', '.slim', '.pug', '.nim', '.sass', '.styl'];

const TEST_GLOBS = [
  'test/**', 'tests/**', 'spec/**', '__tests__/**',
  '**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/test_*.*',
];
const DOC_GLOBS = ['**/*.md', '**/*.mdx', '**/*.rst', '**/*.txt', 'docs/**', 'LICENSE', 'NOTICE'];
const LOCK_GLOBS = [
  '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml',
  '**/Cargo.lock', '**/poetry.lock', '**/Gemfile.lock', '**/go.sum',
];
// A file whose path or added lines look like a credential is never
// auto-patchable, whatever its extension says. This is deliberately a
// path+content heuristic, and it errs toward calling something a secret.
const SECRET_GLOBS = [
  '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx',
  '**/id_rsa', '**/id_ed25519', '**/credentials', '**/*.keystore',
  '**/secrets.*', '**/*.secrets.*',
];

// Matches an assignment whose value looks like a live credential.
const SECRET_LINE = /(?:api[_-]?key|secret|passwd|password|token|private[_-]?key|access[_-]?key|client[_-]?secret)\s*[=:]\s*["']?[A-Za-z0-9/+_\-]{16,}/i;
const SECRET_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/;

const CONFIG_GLOBS = [
  '**/*.json', '**/*.toml', '**/*.ini', '**/*.cfg', '**/*.conf',
  '**/*.yaml', '**/*.yml', '.github/**', '**/*.env.example',
];

function ext(path) {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i).toLowerCase();
}

function stripAll(s) {
  return s.replace(/\s+/g, '');
}

// Multiset equality on whitespace-stripped lines: the same content, respaced.
function isWhitespaceOnly(file) {
  const a = file.added.map(stripAll).filter(Boolean).sort();
  const r = file.removed.map(stripAll).filter(Boolean).sort();
  if (a.length !== r.length) return false;
  return a.every((v, i) => v === r[i]);
}

export function classify(file) {
  const notes = [];

  if (file.binary) return { category: 'binary', notes: ['binary diff; content was not inspected'] };
  if (file.status === 'deleted') return { category: 'delete', notes: ['file removed'] };
  if (file.status === 'renamed') return { category: 'rename', notes: ['path changed'] };

  if (matchesAny(file.path, SECRET_GLOBS)) {
    return { category: 'secret', notes: ['path matches a credential filename pattern'] };
  }
  const secretLine = file.added.find(l => SECRET_LINE.test(l) || SECRET_BLOCK.test(l));
  if (secretLine) {
    return { category: 'secret', notes: ['an added line looks like a credential; the value is not printed'] };
  }

  if (matchesAny(file.path, LOCK_GLOBS)) return { category: 'lockfile', notes };
  if (matchesAny(file.path, DOC_GLOBS)) return { category: 'docs', notes };

  const isTest = matchesAny(file.path, TEST_GLOBS);

  if (isWhitespaceOnly(file)) {
    if (WHITESPACE_SENSITIVE.includes(ext(file.path))) {
      notes.push(`whitespace-only, but ${ext(file.path)} is whitespace-sensitive; not classified as lint`);
    } else {
      return { category: 'lint', notes };
    }
  }

  if (isTest) return { category: 'test', notes };
  if (matchesAny(file.path, CONFIG_GLOBS)) return { category: 'config', notes };

  return { category: 'logic', notes };
}
