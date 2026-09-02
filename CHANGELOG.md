# Changelog

## 0.2.0

Added

- **`secret` category.** A file whose path looks like a credential store, or
  whose added lines look like a live key, is classified as `secret`. No seat can
  be chartered to produce one: a charter that lists `secret` under `may_change`
  is rejected at load time rather than honoured. The matched value is never
  printed in any output format, so a refusal does not itself leak the thing it
  refused.
- **Scale limits.** `max_files` and `max_lines` are properties of a patch, not
  of a file. A patch where every single file is inside the charter, but which is
  ten times the size that seat normally produces, is refused on scale, and the
  reason names the count rather than blaming a file.
- **`chalkline explain --seat <name>`.** Prints a seat's charter as prose,
  including what it cannot produce, without needing a diff. Answers "what is
  this seat even allowed to do" before anything has run.
- **`chalkline seats`.** Lists every declared seat and what each may change.
- **`--format github`.** Emits workflow annotations, so a refusal lands on the
  PR diff next to the file that caused it instead of only in a log.

Changed

- `--json` is now `--format json`; the old flag still works.
- Test count 29 -> 39.

## 0.1.0

Initial release. Charter, diff classification, three verdicts, evidence block.

### Note on fixtures

The secret-detection fixture uses an obviously fake constant rather than a
realistic key format. A test fixture that looks like a live credential trips
every scanner that reads this repository, and a security tool whose own test
data raises alerts is a bad neighbour.
