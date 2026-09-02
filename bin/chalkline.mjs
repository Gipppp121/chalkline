#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseDiff } from '../src/diff.mjs';
import { loadCharter, getSeat } from '../src/charter.mjs';
import { judge } from '../src/verdict.mjs';
import { renderText, renderJson, renderGithub, renderExplain } from '../src/report.mjs';

const USAGE = `chalkline — refuse an agent's patch that left the seat it was chartered to work in

  chalkline check   --seat <name> [options]
  chalkline explain --seat <name> [--charter <path>]
  chalkline seats   [--charter <path>]

  --seat <name>       which seat produced this patch (required for check/explain)
  --charter <path>    charter file (default: charter.json)
  --diff <path>       read a unified diff from a file, or - for stdin
  --range <a..b>      read the diff from git instead (default: HEAD~1..HEAD)
  --format <fmt>      text (default), json, or github for PR annotations
  --held-is-ok        exit 0 on a held verdict instead of 2

  exit 0 allowed   exit 1 refused   exit 2 held   exit 3 usage or charter error
`;

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = f => process.argv.includes(f);
const die = (msg, code = 3) => { process.stderr.write(msg + '\n'); process.exit(code); };

function readDiff() {
  const file = arg('--diff');
  if (file === '-') return readFileSync(0, 'utf8');
  if (file) return readFileSync(file, 'utf8');
  const range = arg('--range', 'HEAD~1..HEAD');
  try {
    return execFileSync('git', ['diff', '--no-color', range], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`could not read a diff from git for range ${range}: ${e.message.split('\n')[0]}`);
  }
}

function openCharter() {
  const charterPath = arg('--charter', 'charter.json');
  try {
    return { charterPath, charter: loadCharter(charterPath) };
  } catch (e) {
    die(e.message);
  }
}

function main() {
  const cmd = process.argv[2];
  if (has('--help') || has('-h') || !cmd) die(USAGE);

  if (cmd === 'seats') {
    const { charter, charterPath } = openCharter();
    const names = Object.keys(charter.seats);
    process.stdout.write(`${names.length} seat(s) in ${charterPath}\n\n`);
    for (const n of names) {
      const s = charter.seats[n];
      process.stdout.write(`  ${n.padEnd(18)} may change: ${s.may_change.join(', ')}\n`);
    }
    process.exit(0);
  }

  if (cmd !== 'check' && cmd !== 'explain') {
    die(`unknown command "${cmd}"\n\n${USAGE}`);
  }

  const seatName = arg('--seat');
  if (!seatName) die('--seat is required. A patch with no declared seat has no stopline to check it against.');

  const { charter, charterPath } = openCharter();
  let seat;
  try { seat = getSeat(charter, seatName); } catch (e) { die(e.message); }

  if (cmd === 'explain') {
    process.stdout.write(renderExplain(seatName, seat) + '\n');
    process.exit(0);
  }

  let files;
  try { files = parseDiff(readDiff()); } catch (e) { die(e.message); }

  const result = judge(files, seat, seatName);
  const fmt = arg('--format', has('--json') ? 'json' : 'text');

  let out;
  if (fmt === 'json') out = renderJson(result, { charterPath });
  else if (fmt === 'github') out = renderGithub(result);
  else if (fmt === 'text') out = renderText(result, { charterPath });
  else die(`unknown --format "${fmt}". Use text, json, or github.`);

  process.stdout.write(out + '\n');

  if (result.verdict === 'refused') process.exit(1);
  if (result.verdict === 'held') process.exit(has('--held-is-ok') ? 0 : 2);
  process.exit(0);
}

main();
