#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseDiff } from '../src/diff.mjs';
import { loadCharter, getSeat } from '../src/charter.mjs';
import { judge } from '../src/verdict.mjs';
import { renderText, renderJson } from '../src/report.mjs';

const USAGE = `stopline — refuse an agent's patch that left the seat it was chartered to work in

  chalkline check --seat <name> [options]

  --seat <name>       which seat in the charter this patch was produced by (required)
  --charter <path>    charter file (default: charter.json)
  --diff <path>       read a unified diff from a file, or - for stdin
  --range <a..b>      read the diff from git instead (default: HEAD~1..HEAD)
  --json              machine-readable output
  --held-is-ok        exit 0 on a held verdict instead of 2

  exit 0 allowed   exit 1 refused   exit 2 held   exit 3 usage or charter error
`;

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = f => process.argv.includes(f);

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

function main() {
  if (has('--help') || has('-h') || process.argv.length < 3) {
    process.stdout.write(USAGE);
    process.exit(3);
  }
  if (process.argv[2] !== 'check') {
    process.stderr.write(`unknown command "${process.argv[2]}"\n\n${USAGE}`);
    process.exit(3);
  }

  const seatName = arg('--seat');
  if (!seatName) {
    process.stderr.write('--seat is required. A patch with no declared seat has no stopline to check it against.\n');
    process.exit(3);
  }

  const charterPath = arg('--charter', 'charter.json');
  let charter, seat;
  try {
    charter = loadCharter(charterPath);
    seat = getSeat(charter, seatName);
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exit(3);
  }

  let files;
  try {
    files = parseDiff(readDiff());
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exit(3);
  }

  const result = judge(files, seat, seatName);
  const opts = { charterPath };
  process.stdout.write((has('--json') ? renderJson(result, opts) : renderText(result, opts)) + '\n');

  if (result.verdict === 'refused') process.exit(1);
  if (result.verdict === 'held') process.exit(has('--held-is-ok') ? 0 : 2);
  process.exit(0);
}

main();
