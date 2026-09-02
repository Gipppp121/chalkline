import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDiff, globToRe, matchesAny } from '../src/diff.mjs';
import { classify } from '../src/classify.mjs';
import { loadCharter, getSeat, CATEGORIES } from '../src/charter.mjs';
import { judge } from '../src/verdict.mjs';
import { renderText, renderJson, renderGithub, renderExplain } from '../src/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = n => readFileSync(join(HERE, 'fixtures', n), 'utf8');
const charterPath = join(HERE, '..', 'charter.example.json');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || ''} expected ${B}, got ${A}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

/* --- glob --- */
t('glob: ** spans directories', () => ok(globToRe('src/**').test('src/a/b/c.js')));
t('glob: **/ matches zero dirs', () => ok(globToRe('**/*.md').test('README.md')));
t('glob: * stops at separator', () => ok(!globToRe('src/*.js').test('src/a/b.js')));
t('glob: brace alternation', () => ok(globToRe('**/*.{yml,yaml}').test('ci/deploy.yaml')));
t('glob: literal dot is escaped', () => ok(!globToRe('*.js').test('axjs')));
t('matchesAny: empty list matches nothing', () => ok(!matchesAny('a.js', [])));

/* --- diff parsing --- */
t('diff: reads path and counts hunks', () => {
  const f = parseDiff(fx('lint-only.diff'));
  eq(f.length, 1);
  eq(f[0].path, 'src/utils.js');
  eq(f[0].hunks, 1);
});
t('diff: separates added from removed', () => {
  const f = parseDiff(fx('logic-change.diff'))[0];
  eq(f.added.length, 1);
  eq(f.removed.length, 1);
});
t('diff: empty input yields no files', () => eq(parseDiff(fx('empty.diff')).length, 0));
t('diff: --- and +++ headers are not counted as changes', () => {
  const f = parseDiff(fx('test-only.diff'))[0];
  ok(!f.added.some(l => l.startsWith('+ b/')), 'header leaked into added lines');
});

/* --- classification --- */
t('classify: respacing js is lint', () => eq(classify(parseDiff(fx('lint-only.diff'))[0]).category, 'lint'));
t('classify: changed condition is logic', () => eq(classify(parseDiff(fx('logic-change.diff'))[0]).category, 'logic'));
t('classify: file under test/ is test', () => eq(classify(parseDiff(fx('test-only.diff'))[0]).category, 'test'));
t('classify: python whitespace is NOT lint', () => {
  const c = classify(parseDiff(fx('python-whitespace.diff'))[0]);
  ok(c.category !== 'lint', 'whitespace-sensitive language was called lint');
  ok(c.notes.length > 0, 'no note explaining the refusal to call it lint');
});
t('classify: workflow file is config', () => eq(classify(parseDiff(fx('workflow-touch.diff'))[0]).category, 'config'));

/* --- charter --- */
t('charter: loads the example', () => ok(loadCharter(charterPath).seats['fix-bot']));
t('charter: unknown seat is an error', () => {
  const c = loadCharter(charterPath);
  let threw = false;
  try { getSeat(c, 'nope'); } catch { threw = true; }
  ok(threw, 'getSeat accepted an undeclared seat');
});
t('charter: missing file is an error naming the path', () => {
  let msg = '';
  try { loadCharter('/nonexistent/charter.json'); } catch (e) { msg = e.message; }
  ok(msg.includes('/nonexistent/charter.json'), 'error did not name the path');
});

/* --- verdicts --- */
const charter = loadCharter(charterPath);
const fixSeat = getSeat(charter, 'fix-bot');

t('verdict: lint inside charter is allowed', () => {
  eq(judge(parseDiff(fx('lint-only.diff')), fixSeat, 'fix-bot').verdict, 'allowed');
});
t('verdict: logic change is refused', () => {
  const r = judge(parseDiff(fx('logic-change.diff')), fixSeat, 'fix-bot');
  eq(r.verdict, 'refused');
  ok(r.crossed[0].reasons.some(x => x.includes('logic')), 'reason did not name the category');
});
t('verdict: test edit is allowed for fix-bot', () => {
  eq(judge(parseDiff(fx('test-only.diff')), fixSeat, 'fix-bot').verdict, 'allowed');
});
t('verdict: never list beats everything', () => {
  const r = judge(parseDiff(fx('workflow-touch.diff')), fixSeat, 'fix-bot');
  eq(r.verdict, 'refused');
  ok(r.crossed[0].reasons.some(x => x.includes('never')), 'never list was not the stated reason');
});
t('verdict: unreadable classification is held, not allowed', () => {
  const seat = { may_change: ['logic', 'lint'], may_touch: ['src/**'] };
  const r = judge(parseDiff(fx('python-whitespace.diff')), seat, 'x');
  eq(r.verdict, 'held');
});
t('verdict: empty diff is held, never allowed', () => {
  eq(judge(parseDiff(fx('empty.diff')), fixSeat, 'fix-bot').verdict, 'held');
});
t('verdict: docs-bot may not touch source', () => {
  const seat = getSeat(charter, 'docs-bot');
  eq(judge(parseDiff(fx('logic-change.diff')), seat, 'docs-bot').verdict, 'refused');
});

/* --- report --- */
t('report: refusal names the offending file', () => {
  const r = judge(parseDiff(fx('logic-change.diff')), fixSeat, 'fix-bot');
  ok(renderText(r, { charterPath }).includes('src/auth.js'));
});
t('report: allowed output does not claim the change is good', () => {
  const r = judge(parseDiff(fx('lint-only.diff')), fixSeat, 'fix-bot');
  ok(renderText(r, { charterPath }).includes('not a statement that the change is good'));
});
t('report: empty diff says nothing was checked', () => {
  const r = judge(parseDiff(fx('empty.diff')), fixSeat, 'fix-bot');
  ok(renderText(r, { charterPath }).includes('nothing was checked'));
});
t('report: json carries its own limitations', () => {
  const r = judge(parseDiff(fx('lint-only.diff')), fixSeat, 'fix-bot');
  const j = JSON.parse(renderJson(r, { charterPath }));
  ok(j.limits.does_not_read.includes('intent'));
});

/* --- secrets --- */
t('classify: a credential-looking added line is a secret', () => {
  const c = classify(parseDiff(fx('secret-leak.diff'))[0]);
  eq(c.category, 'secret');
  ok(c.notes[0].includes('not printed'), 'note did not promise to withhold the value');
});
t('report: a secret refusal never echoes the value', () => {
  const r = judge(parseDiff(fx('secret-leak.diff')), fixSeat, 'fix-bot');
  const out = renderText(r, { charterPath }) + renderJson(r, { charterPath });
  ok(!out.includes('EXAMPLE0000NOTAREALKEY0000FIXTURE'), 'the credential leaked into the report');
});
t('classify: a credential filename is a secret regardless of content', () => {
  const f = { path: '.env.production', status: 'added', added: ['X=1'], removed: [], hunks: 1, binary: false };
  eq(classify(f).category, 'secret');
});
t('charter: no seat may be chartered to change a secret', () => {
  let msg = '';
  try {
    const tmp = { seats: { x: { may_change: ['secret'] } } };
    const p2 = join(HERE, 'fixtures', '.tmp-charter.json');
    writeFileSync(p2, JSON.stringify(tmp));
    loadCharter(p2);
  } catch (e) { msg = e.message; }
  ok(msg.includes('secret'), 'a secret-allowing charter was accepted');
});

/* --- scale --- */
t('verdict: too many files is refused even when every file is allowed', () => {
  const r = judge(parseDiff(fx('oversized.diff')), fixSeat, 'fix-bot');
  eq(r.verdict, 'refused');
  eq(r.crossed.length, 0, 'a file was blamed for what is a whole-patch problem');
  ok(r.scale[0].includes('6 files'), 'scale reason did not state the count');
});
t('verdict: max_lines counts the whole patch', () => {
  const seat = { may_change: ['test'], max_lines: 3 };
  const r = judge(parseDiff(fx('oversized.diff')), seat, 'x');
  eq(r.verdict, 'refused');
  ok(r.scale.some(s => s.includes('lines')), 'no line-count reason given');
});
t('charter: max_files must be a positive integer', () => {
  ok(CATEGORIES.includes('secret'), 'secret is not a known category');
});

/* --- output formats --- */
t('github: refusal becomes a file-scoped error annotation', () => {
  const r = judge(parseDiff(fx('logic-change.diff')), fixSeat, 'fix-bot');
  const out = renderGithub(r);
  ok(out.startsWith('::error file=src/auth.js'), 'annotation was not file-scoped');
});
t('github: a held file becomes a warning, not an error', () => {
  const seat = { may_change: ['logic', 'lint'], may_touch: ['src/**'] };
  const out = renderGithub(judge(parseDiff(fx('python-whitespace.diff')), seat, 'x'));
  ok(out.startsWith('::warning'), 'held was reported as an error');
});
t('explain: states what the seat cannot produce', () => {
  const out = renderExplain('fix-bot', fixSeat);
  ok(out.includes('cannot produce'), 'explain did not list the refusals');
  ok(out.includes('not thereby correct'), 'explain implied allowed means good');
});

try { rmSync(join(HERE, 'fixtures', '.tmp-charter.json')); } catch {}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
