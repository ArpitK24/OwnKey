<p align="center">
  <img src="https://raw.githubusercontent.com/ArpitK24/OwnKey/main/assets/logo.png" alt="OwnKey" width="420">
</p>

<h3 align="center">The local-first AI coding agent that runs on your own keys.</h3>

<p align="center">
  Scan a codebase, get reviewable suggestions as unified diffs, apply them with automatic backups, and undo in one command.<br>
  OpenAI, Anthropic, Google Gemini, or fully offline with Ollama. No account, no telemetry, no required database.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ownkey"><img src="https://img.shields.io/npm/v/ownkey?style=flat-square&color=111111&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/ownkey"><img src="https://img.shields.io/npm/dm/ownkey?style=flat-square&color=111111" alt="npm downloads"></a>
  <img src="https://img.shields.io/node/v/ownkey?style=flat-square&color=111111" alt="node version">
  <a href="https://github.com/ArpitK24/OwnKey/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/ownkey?style=flat-square&color=111111" alt="license"></a>
</p>

<p align="center">
  <a href="https://ownkey.qzz.io/docs">Documentation</a> &nbsp;&middot;&nbsp;
  <a href="https://ownkey.qzz.io/docs/getting-started">Quick start</a> &nbsp;&middot;&nbsp;
  <a href="https://ownkey.qzz.io/docs/commands">CLI reference</a> &nbsp;&middot;&nbsp;
  <a href="https://github.com/ArpitK24/OwnKey/blob/main/CHANGELOG.md">Changelog</a>
</p>

---

## Overview

OwnKey is a command-line coding agent for developers who want AI code review without handing their workflow to a hosted service. It reads your project locally, sends only the files under analysis to the model provider you choose, and returns structured suggestions: bugs, security issues, performance problems, refactors, and more, each with a severity, a rationale, and a patch you can inspect before anything touches disk.

```text
scan  ->  suggest  ->  apply  ->  undo
 map       review       patch      restore
```

| | |
|---|---|
| **Bring your own key** | Use your existing OpenAI, Anthropic, or Gemini account, or any OpenAI-compatible endpoint. You pay your provider directly; OwnKey adds nothing in between. |
| **Fully offline option** | Point OwnKey at a local Ollama server and no code leaves your machine. |
| **Review before write** | Every suggestion carries a unified diff. `apply` previews it and asks for confirmation; `--dry-run` never writes. |
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

**2. Analyze a project**

```bash
cd my-project
ownkey scan .            # see what will be analyzed
ownkey suggest .         # generate suggestions
```

**3. Review and apply**

```bash
ownkey apply                          # list pending suggestions
ownkey apply <id> --dry-run           # preview the diff, write nothing
ownkey apply <id>                     # preview, confirm, apply with backup
ownkey apply --all --severity high    # apply everything rated high or critical
```

**4. Undo if needed**

```bash
ownkey undo --list                    # recent applies
ownkey undo <backup-id>               # restore that apply
```

## Commands

| Command | Purpose |
|---|---|
| `ownkey config` | Set the AI provider, model, endpoint, and optional database. Run with no flags for an interactive wizard. |
| `ownkey scan [path]` | List the files OwnKey would analyze, honoring `.gitignore` and `.ownkeyignore`. |
| `ownkey suggest [path]` | Analyze files and store suggestions for review. |
| `ownkey apply [id]` | Apply one suggestion, or all pending ones with `--all`. |
| `ownkey undo [backup-id]` | Restore files from a backup created by `apply`. |

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
| `--project <path>` | Project the suggestions belong to. Default `.`. |
| `--force` | Apply matching hunks even if others do not match. |
| `--no-backup` | Skip the backup. Not recommended. |

#### `ownkey undo [backup-id]`

| Option | Description |
|---|---|
| `--list` | List recent applies. |
| `--all` | Undo all applies from today. |
| `-y, --yes` | Skip the confirmation prompt. |

#### Global options

`--local-only`, `--verbose`, `--debug`, `--quiet`

</details>

## Providers

| Provider | Setup | Notes |
|---|---|---|
| OpenAI | `--provider openai --api-key <key>` | Any chat model on your account. |
| Anthropic | `--provider anthropic --api-key <key>` | Any Claude model on your account. |
| Google Gemini | `--provider gemini --api-key <key>` | Keys from Google AI Studio. |
| Ollama | `--provider ollama [--endpoint http://host:11434]` | Runs entirely on your hardware. No key. |
| OpenAI-compatible | `--provider openai --endpoint <base-url> --api-key <key>` | OpenRouter, Groq, LM Studio, vLLM, and similar. |

```bash
# Example: OpenRouter through the OpenAI-compatible endpoint
ownkey config --provider openai \
  --endpoint https://openrouter.ai/api/v1 \
  --api-key sk-or-... \
  --model anthropic/claude-sonnet-4.5
```

## How apply works

1. The suggestion's unified diff is parsed and matched against the current file. Small line-number drift is tolerated; hunks whose context does not match are rejected rather than guessed.
2. The diff is shown and you confirm (skipped with `--auto`, not available without a terminal unless `--auto` is set).
3. A backup of every affected file is written to `~/.ownkey/backups`.
4. Changes are written, preserving the file's line endings. New files proposed by the model are created.
5. The suggestion is marked applied, so it cannot be applied twice by accident.

`ownkey undo` reverses step 4 exactly, including removing files that the apply created.

## Data and privacy

| Location | Contents |
|---|---|
| `~/.ownkey/config.json` | Provider, model, endpoint, and database settings. |
| OS keychain | API keys, by default. |
| `~/.ownkey/keys.enc` | Encrypted key file, used when no keychain is available or `OWNKEY_NO_KEYCHAIN=1` is set. |
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
ownkey suggest . --severity high
ownkey apply --all --severity high --auto
```

## Development

```bash
git clone https://github.com/ArpitK24/OwnKey.git
cd OwnKey
npm install
npm run build
npm test
```

The test suite runs every command end to end against a mock Ollama server, plus unit tests for the diff engine and response parsing. Database tests are opt-in:

```bash
OWNKEY_TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm test
```

## Contributing

Issues and pull requests are welcome. For a change in behavior, please open an issue first to discuss it. Before submitting, run `npm run build` and `npm test`.

Report bugs at [github.com/ArpitK24/OwnKey/issues](https://github.com/ArpitK24/OwnKey/issues).

## License

[MIT](LICENSE) &copy; 2026 OwnKey
