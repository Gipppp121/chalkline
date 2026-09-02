# chalkline

**Refuses an agent's patch that left the seat it was chartered to work in.**

An agent that opens pull requests will eventually open one that touches something
nobody agreed it could touch. Not maliciously. It found a related file, the fix
looked obvious, and no rule said otherwise.

`chalkline` is that rule, written down as a file and checked in CI.

Every seat is defined by what it **cannot** do. The patch either stayed inside
that definition or it did not, and chalkline reports which — with the offending
file named, never summarised into a score.

---

## What it is not

It does not read intent. It does not run tests. It has no opinion on whether a
patch is correct, elegant, or necessary. It reads a textual diff and answers one
question: **did this seat change only what it said it would?**

A patch can be inside its charter and still be wrong. chalkline says so out loud
in its own output rather than letting a green check imply otherwise.

---

## Install

```
git clone https://github.com/<you>/chalkline && cd chalkline
node test/run.mjs
npm link
cp charter.example.json charter.json
```

| | |
| --- | --- |
| **Required** | Node 18+ |
| **Runtime dependencies** | zero |
| **Network access** | none. It never calls out. |

---

## The charter

One entry per seat. `may_change` is the list of categories that seat is allowed
to produce; everything else is a refusal.

```json
{
  "seats": {
    "fix-bot": {
      "stopline": "opens draft PRs only; merging is not this seat's decision",
      "may_change": ["lint", "test"],
      "may_touch": ["src/**", "test/**"],
      "never": ["**/migrations/**", ".github/workflows/**"]
    }
  }
}
```

The `stopline` field is prose for humans. Nothing reads it. It records what the
seat was for, so whoever edits this file in six months knows what the line meant.

`never` beats everything. A path on the never list is refused even if its
category is allowed and it sits inside `may_touch` — that is the point of having
a separate list.

The `chalkline` field is prose for humans. Nothing reads it. It exists so the
person editing the file six months from now knows what the seat was for.

---

## A check, end to end

```
chalkline check --seat fix-bot --diff pr.diff
```

```
REFUSED  seat "fix-bot"  1 file(s) changed

  FILE          CATEGORY   LINES  STOPLINE
  src/auth.js   logic      2      crossed

  crossed the stopline:
    ! src/auth.js: category "logic" is not in may_change

  This patch is not inside what the seat was chartered to change.
  chalkline does not judge whether the patch is correct. Only whether
  it stayed where it said it would.
```

Read the diff from git instead of a file:

```
chalkline check --seat fix-bot --range origin/main...HEAD
chalkline check --seat docs-bot --diff - < patch.diff
chalkline check --seat fix-bot --json
```

Other commands:

```
chalkline explain --seat fix-bot     # what is this seat even allowed to do
chalkline seats                      # every declared seat, at a glance
```

| Exit | Verdict | Meaning |
| --- | --- | --- |
| `0` | `allowed` | every changed file is inside the charter |
| `1` | `refused` | something crossed the stopline, and the file is named |
| `2` | `held` | nothing crossed, but something could not be read confidently |
| `3` | — | usage error, or a charter that does not load |

---

## Held is not a soft allow

`held` exists because "I could not classify this" and "this is fine" are
different statements, and collapsing them is how a gate becomes decoration.

Two things produce it:

**An empty diff.** No files means nothing was checked. That is not the same as
a patch that passed, so it never exits 0 on its own.

**A whitespace-only change in a whitespace-sensitive language.** In JavaScript,
respacing a line is formatting. In Python or YAML, indentation *is* the program.
chalkline will not call that lint, so it falls through to the file's real
category and prints why:

```
  could not be classified with confidence:
    ? src/pipeline.py: whitespace-only, but .py is whitespace-sensitive; not classified as lint
```

If you want held to pass in CI, you have to say so explicitly with
`--held-is-ok`. It is a choice, and it should look like one.

---

## Secrets are never chartered

A file whose path looks like a credential store, or whose added lines look like
a live key, is classified `secret`. No seat can be given permission to produce
one: a charter listing `secret` under `may_change` is rejected when it loads,
not honoured.

```
seat "fix-bot" allows "secret". No seat may be chartered to change a
credential; remove it and handle those by hand.
```

The matched value is never printed, in any output format. A refusal that echoed
the key it refused would be the same leak with extra steps.

---

## Scale is its own stopline

`max_files` and `max_lines` describe the patch, not any file in it.

```json
"fix-bot": {
  "may_change": ["lint", "test"],
  "max_files": 5,
  "max_lines": 200
}
```

A patch where every file is inside the charter, but which is six times the size
that seat usually produces, is still a different kind of event. It is refused on
scale, and the reason names the count instead of blaming a file that did nothing
wrong:

```
  crossed on scale:
    ! 6 files changed; this seat's charter allows 5
```

---

## Categories

| Category | Assigned when |
| --- | --- |
| `lint` | added and removed lines are identical once whitespace is stripped |
| `test` | path matches `test/**`, `**/*.test.*`, `**/*_test.*`, and friends |
| `docs` | markdown, rst, txt, `docs/**`, LICENSE, NOTICE |
| `lockfile` | package-lock, yarn.lock, Cargo.lock, poetry.lock, go.sum, … |
| `config` | json, toml, ini, yaml, `.github/**` |
| `secret` | path or added content looks like a credential; never chartered |
| `logic` | anything that did not match the above |
| `delete` / `rename` / `binary` | from the diff header, not the content |

`logic` is the default on purpose. A file chalkline does not recognise is treated
as the most restricted thing it could be, not the least.

---

## Honesty rules

- It reads the diff you hand it. A diff that omits a file is a file chalkline
  never saw, and it cannot know that happened.
- `lint` is whitespace-normalised line equality. It is a heuristic. A rename
  that only changes indentation would read as lint in a language where that is
  true, and chalkline refuses to guess where it is not.
- It cannot stop a merge on its own. It exits non-zero; making that block
  anything is a branch-protection setting you configure, not something this
  tool can enforce from inside a workflow.
- It does not know which seat wrote a patch. You tell it, via `--seat`. A
  mislabelled PR is checked against the wrong charter and chalkline has no way
  to notice.
- The secret heuristic errs toward calling something a credential. It will flag
  a long random-looking string assigned to a variable named `token`, whether or
  not it is live. A false positive here costs you one manual look; the reverse
  costs more.
- No scores. No percentages. No "compliance rate". Every output names files.

---

## Annotations in CI

`--format github` turns a refusal into a workflow annotation, so it appears on
the PR diff next to the file that caused it:

```
::error file=src/auth.js,title=chalkline (fix-bot)::category "logic" is not in may_change
```

Held files become warnings rather than errors, because held is not a refusal.

---

## Tests

```
./test.sh
```

39 tests, local fixtures only. No network, no git, no account. CI runs the same
suite on Node 18 and 22.

---

## License

MIT. If you publish reports derived from this, keep the limitations above
attached to them.
