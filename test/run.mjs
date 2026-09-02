import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDiff, globToRe, matchesAny } from '../src/diff.mjs';
import { classify } from '../src/classify.mjs';
import { loadCharter, getSeat } from '../src/charter.mjs';
import { judge } from '../src/verdict.mjs';
import { renderText, renderJson } from '../src/report.mjs';

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

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
