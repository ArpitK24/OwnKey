<h1 align="center">OwnKey</h1>

<h3 align="center">The local-first AI code reviewer that runs on your own keys.</h3>

<p align="center">
  Review your changes before you commit, gate pull requests in CI, and apply fixes as verified, reversible diffs.<br>
  OpenAI, Anthropic, Google Gemini, or fully offline with Ollama. No account, no telemetry, no required database.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ownkey"><img src="https://img.shields.io/npm/v/ownkey.svg" alt="npm version"></a>
  <img src="https://img.shields.io/node/v/ownkey.svg" alt="node version">
  <a href="https://github.com/ArpitK24/OwnKey/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="license"></a>
</p>

<p align="center">
  <a href="https://ownkey.qzz.io/docs">Documentation</a> &nbsp;&middot;&nbsp;
  <a href="https://ownkey.qzz.io/docs/getting-started">Quick start</a> &nbsp;&middot;&nbsp;
  <a href="https://ownkey.qzz.io/docs/commands">CLI reference</a> &nbsp;&middot;&nbsp;
  <a href="https://github.com/ArpitK24/OwnKey/blob/main/CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://github.com/ArpitK24/OwnKey/blob/main/assets/ownkey-demo.mp4"><img src="https://raw.githubusercontent.com/ArpitK24/OwnKey/main/assets/ownkey-demo.gif" alt="OwnKey reviewing staged changes, applying a fix verified by tests, and commenting on a pull request" width="880"></a>
  <br><sub><a href="https://github.com/ArpitK24/OwnKey/blob/main/assets/ownkey-demo.mp4">Watch in 1080p</a></sub>
</p>

---

## Overview

OwnKey is a command-line code reviewer for developers who want AI review without handing their workflow to a hosted service. It reads your repository locally, sends only the code under review to the model provider you choose, and returns structured findings: bugs, security issues, performance problems, refactors, and more, each with a severity, a rationale, and a patch you can inspect before anything touches disk.

```text
review  ->  apply --verify  ->  undo
 diff        patch + test        restore
```

Use `ownkey review` on what you just changed, in a pre-commit hook, or as a GitHub Action on every pull request. Use `ownkey suggest` for a full audit of any folder.

| | |
|---|---|
| **Bring your own key** | Use your existing OpenAI, Anthropic, or Gemini account, or any OpenAI-compatible endpoint. You pay your provider directly; OwnKey adds nothing in between. |
| **Fully offline option** | Point OwnKey at a local Ollama server and no code leaves your machine. |
| **Reviews what changed** | `review` looks at staged changes, uncommitted work, or a branch against its base, and reports only on those lines. |
| **Built for CI** | SARIF for GitHub code scanning, Markdown for PR comments, JSON for tooling, and `--fail-on` exit codes for gating. |
| **Verified fixes** | `apply --verify "npm test"` runs your checks after each fix and reverts it automatically if they fail. |
| **Safe by default** | Each apply creates a backup first. `undo` restores modified files and removes files the apply created. |
| **Standalone** | Suggestions and backups live in `~/.ownkey`. A Postgres or Supabase database is optional, for teams that want shared history. |

## Requirements

- Node.js 18 or later
- An API key for OpenAI, Anthropic, or Google Gemini, **or** a running [Ollama](https://ollama.com) server

## Installation

```bash
npm install -g ownkey
ownkey --version
```

## Quick start

**1. Configure a provider**

```bash
# Hosted providers
ownkey config --provider openai    --api-key sk-...
ownkey config --provider anthropic --api-key sk-ant-...
ownkey config --provider gemini    --api-key AIza...

# Fully local, no key required
ownkey config --provider ollama --model qwen2.5-coder:latest
```

Any model your key can access works. Set it with `--model`; OwnKey does not maintain a model allowlist.

**2. Review your changes**

```bash
cd my-repo
ownkey review                         # staged changes, or uncommitted work if nothing is staged
ownkey review --base origin/main      # everything on this branch
```

**3. Apply fixes, verified**

```bash
ownkey apply                          # list pending suggestions
ownkey apply <id> --dry-run           # preview the diff, write nothing
ownkey apply <id> --verify "npm test" # apply, run tests, revert automatically on failure
ownkey apply --all --severity high    # apply everything rated high or critical
```

**4. Undo if needed**

```bash
ownkey undo --last                    # restore the most recent apply
ownkey undo --list                    # recent applies
```

For a whole-project audit of any folder, git or not, use `ownkey suggest .`

## Commands

| Command | Purpose |
|---|---|
| `ownkey config` | Set the AI provider, model, endpoint, and optional database. Run with no flags for an interactive wizard. |
| `ownkey review [path]` | Review git changes: staged, uncommitted, or a branch against its base. |
| `ownkey suggest [path]` | Audit a whole folder and store suggestions. |
| `ownkey scan [path]` | List the files OwnKey would analyze, honoring `.gitignore` and `.ownkeyignore`. |
| `ownkey apply [id]` | Apply one suggestion, or all pending ones with `--all`, optionally verified. |
| `ownkey undo [backup-id]` | Restore files from a backup created by `apply`. |
| `ownkey bench` | Measure review quality on seeded-bug cases with your model. |

<details>
<summary><strong>Full option reference</strong></summary>

#### `ownkey config`

| Option | Description |
|---|---|
| `--show` | Print the current configuration (keys are masked). |
| `--provider <name>` | `openai`, `anthropic`, `gemini`, or `ollama`. |
| `--api-key <key>` | Provider API key. Not needed for Ollama. |
| `--model <model>` | Any model available to your key or Ollama server. |
| `--endpoint <url>` | Ollama server URL, or an OpenAI-compatible base URL with `--provider openai`. |
| `--database-url <url>` | Optional Postgres connection string for shared history. |
| `--no-database` | Remove the database and use local storage only. |
| `--reset` | Reset configuration to defaults. |
| `-y, --yes` | Skip confirmation prompts. |

#### `ownkey review [path]`

| Option | Description |
|---|---|
| `--staged` | Review only staged changes. Default: staged if any, otherwise uncommitted changes. |
| `--base <ref>` | Review everything since the merge base with this ref, such as `origin/main`. |
| `--severity <level>` | Minimum severity to report. |
| `--type <type>` | Only report this type. |
| `--format <format>` | `text` (default), `markdown`, `json`, or `sarif`. |
| `--output <file>` | Write the report to a file instead of stdout. |
| `--sarif-output <file>` | Also write a SARIF report. |
| `--markdown-output <file>` | Also write a Markdown report. |
| `--fail-on <level>` | Exit with code 1 when any finding is at or above this severity. |
| `--max-files <n>` | Maximum changed files to review. Default `25`. |

Exit codes: `0` success, `1` the `--fail-on` gate tripped, `2` the review could not run.

#### `ownkey bench`

| Option | Description |
|---|---|
| `--list` | List the cases and exit. |
| `--case <ids>` | Comma-separated case ids to run. Default: all. |
| `--model <model>` | Use this model for the run instead of the configured one. |
| `--format <format>` | `text` (default), `json`, or `markdown`. |
| `--output <file>` | Write the report to a file. |
| `--min-recall <ratio>` | Exit with code 1 when recall is below this ratio, from `0` to `1`. |

#### `ownkey scan [path]`

| Option | Description |
|---|---|
| `--max-file-size <size>` | Skip files larger than this. Default `500kb`. |
| `--ignore <patterns...>` | Additional ignore patterns. |

#### `ownkey suggest [path]`

| Option | Description |
|---|---|
| `--type <type>` | `bug`, `security`, `performance`, `refactor`, `style`, `architecture`, `test`, or `documentation`. |
| `--severity <level>` | Minimum severity: `critical`, `high`, `medium`, `low`, `info`. |
| `--max-files <n>` | Maximum files to analyze. Default `10`. |

#### `ownkey apply [id]`

| Option | Description |
|---|---|
| `--dry-run` | Show the diff without writing. |
| `--auto` | Apply without the confirmation prompt (for scripts and CI). |
| `--all` | Apply every pending suggestion for the project. |
| `--severity <level>` | With `--all`, only apply at or above this severity. |
| `--verify <command>` | Run this command after each apply; revert automatically if it fails. |
| `--project <path>` | Project the suggestions belong to. Default `.`. |
| `--force` | Apply matching hunks even if others do not match. |
| `--no-backup` | Skip the backup. Not recommended. |

#### `ownkey undo [backup-id]`

| Option | Description |
|---|---|
| `--last` | Undo the most recent apply. |
| `--list` | List recent applies. |
| `--all` | Undo all applies from today. |
| `-y, --yes` | Skip the confirmation prompt. |

#### Global options

`--local-only`, `--verbose`, `--debug`, `--quiet`

</details>

## Measuring review quality

`ownkey bench` shows how well a model reviews before you trust it with your pull requests. It runs a fixed set of small cases, each a throwaway git repository with one staged change:

- **Bug cases** plant one real defect: an off-by-one, SQL injection, a missing `await`, a null dereference, a hardcoded secret, path traversal, command injection, an inverted auth check, a mutable default argument, a numeric sort with the string comparator, a switch fallthrough, and `is` used to compare strings. They cover JavaScript, TypeScript, and Python.
- **Control cases** are correct changes. Anything reported there at medium severity or above is a false alarm.

```bash
ownkey bench                                  # all cases with your configured model
ownkey bench --model claude-opus-5-5          # compare another model on the same key
ownkey bench --format markdown --output bench.md
```

It reports **recall** (planted bugs reported within 3 lines of the defect with a matching type), **precision** (matching findings over all findings at medium or above), and how many controls stayed clean. Low and info findings never count against a model. Bench runs in temporary directories and stores nothing, but it does send every case to your provider, so a full run costs about 15 small review calls.

## Providers

| Provider | Setup | Default model |
|---|---|---|
| OpenAI | `--provider openai --api-key <key>` | `gpt-6.1-sol` |
| Anthropic | `--provider anthropic --api-key <key>` | `claude-sonnet-5-5` |
| Google Gemini | `--provider gemini --api-key <key>` | `gemini-3.8-flash` |
| Ollama | `--provider ollama [--endpoint http://host:11434]` | `qwen2.5-coder:latest` |
| OpenAI-compatible | `--provider openai --endpoint <base-url> --api-key <key>` | Set with `--model` |

Defaults are mid-tier models chosen for review quality per dollar. Override with `--model`, for example `gpt-6-astra` or `claude-opus-5-5` for the deepest review. OwnKey sends each model the request shape it expects, including reasoning-era OpenAI models and Claude's adaptive thinking.

```bash
# Example: OpenRouter through the OpenAI-compatible endpoint
ownkey config --provider openai \
  --endpoint https://openrouter.ai/api/v1 \
  --api-key sk-or-... \
  --model anthropic/claude-sonnet-4.5
```

## GitHub Action

Review every pull request, post a summary comment, and surface findings in the Security tab.

```yaml
# .github/workflows/ownkey.yml
name: OwnKey review
on: pull_request

permissions:
  contents: read
  pull-requests: write
  security-events: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ArpitK24/OwnKey@v1
        with:
          provider: anthropic
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          fail-on: high
```

| Input | Default | Description |
|---|---|---|
| `provider` | required | `openai`, `anthropic`, `gemini`, or `ollama`. |
| `api-key` | | Provider key, from a repository secret. |
| `model` | provider default | Any model your key can access. |
| `endpoint` | | Ollama URL or OpenAI-compatible base URL. |
| `base` | PR base branch | Ref to review against. |
| `severity` | `low` | Minimum severity to report. |
| `fail-on` | | Fail the job at or above this severity. |
| `comment` | `true` | Post or update one summary comment on the PR. |
| `upload-sarif` | `true` | Upload findings to GitHub code scanning. |
| `version` | `latest` | OwnKey version from npm. |

### Pre-commit hook

```bash
# .git/hooks/pre-commit
#!/bin/sh
exec ownkey review --staged --fail-on high
```

## How apply works

1. The suggestion's unified diff is parsed and matched against the current file. Small line-number drift is tolerated; hunks whose context does not match are rejected rather than guessed.
2. The diff is shown and you confirm (skipped with `--auto`, not available without a terminal unless `--auto` is set).
3. A backup of every affected file is written to `~/.ownkey/backups`.
4. Changes are written, preserving the file's line endings. New files proposed by the model are created.
5. With `--verify`, your command runs in the project. If it exits non-zero, the backup is restored immediately.
6. The suggestion is marked applied, so it cannot be applied twice by accident.

`ownkey undo` reverses step 4 exactly, including removing files that the apply created.

## Data and privacy

| Location | Contents |
|---|---|
| `~/.ownkey/config.json` | Provider, model, endpoint, and database settings. |
| OS keychain | API keys, by default. |
| `~/.ownkey/keys.enc` | AES-256-GCM encrypted key file, used when no keychain is available or `OWNKEY_NO_KEYCHAIN=1` is set. Encrypted with a random per-install secret in `~/.ownkey/master.key`; both files are readable only by you. |
| `~/.ownkey/storage/` | Suggestions, kept for 7 days and capped at 100 per project. |
| `~/.ownkey/backups/` | File backups created by `apply`. |

OwnKey has no telemetry and no OwnKey-operated servers. The only network traffic is to the model provider you configured and, if you enabled it, your own database. With Ollama, analysis is fully local.

Exclude files from analysis with a `.ownkeyignore` file in the project root (same syntax as `.gitignore`). Common build output, dependencies, lockfiles, binaries, and `.env` are excluded by default.

## Optional database

For shared history across machines or a team, connect any Postgres database. Tables are created and migrated automatically on first use.

```bash
# Supabase: Project -> Connect -> Session pooler connection string
ownkey config --database-url "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"

# Return to local-only at any time
ownkey config --no-database
```

If the database is unreachable, OwnKey falls back to local storage and keeps working. `--supabase-url` is accepted as an alias for `--database-url`.

## Using OwnKey in scripts and CI

Every interactive step has a flag, and OwnKey never blocks waiting for input when there is no terminal.

```bash
export OWNKEY_NO_KEYCHAIN=1
ownkey config --provider openai --api-key "$OPENAI_API_KEY" --yes
ownkey review --base origin/main --format sarif --output ownkey.sarif --fail-on high
ownkey apply --all --severity high --auto --verify "npm test"
```

## Development

```bash
git clone https://github.com/ArpitK24/OwnKey.git
cd OwnKey
npm install
npm run build
npm test
```

The test suite runs every command end to end against a mock Ollama server, including `review` against real git repositories, plus unit tests for the diff engine, report formats, response parsing, and provider request shapes. Database tests are opt-in:

```bash
OWNKEY_TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm test
```

## Contributing

Issues and pull requests are welcome. For a change in behavior, please open an issue first to discuss it. Before submitting, run `npm run build` and `npm test`.

Report bugs at [github.com/ArpitK24/OwnKey/issues](https://github.com/ArpitK24/OwnKey/issues).

## License

[MIT](LICENSE) &copy; 2026 OwnKey
