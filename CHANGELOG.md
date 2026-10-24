# Changelog

All notable changes to this project will be documented in this file.

## [1.4.1] - 2026-10-24

### Fixed

- Every command crashed on Windows (and other case-insensitive file systems) with `SyntaxError: The requested module './keeper.js' does not provide an export named 'KEEPER_FPS'`. 1.4.0 shipped `dist/ui/Keeper.js` and `dist/ui/keeper.js`, which are the same file there, so one overwrote the other. The terminal component is now `keeper-view`, and a test fails the build if two paths ever differ only by case.

## [1.4.0] - 2026-10-24

### Added

- Agentic review. `ownkey review` (and `ownkey bench`) now let the model investigate the repository before it reports. It can read files with line numbers, run regex searches, and list folders, so it can open the definition of a function the change calls, find other callers, or check how a value is validated elsewhere. Each tool call is shown as it happens (`↳ read src/orders.ts`). Tools are read-only and limited to files the scanner allows, so anything ignored by `.gitignore` or `.ownkeyignore` (such as `.env`) is never readable. The loop works with every provider through plain JSON turns, with no native tool API needed, and is capped by `--max-steps` (default 6 rounds, 4 calls per round).
- `--quick` on `review` and `bench` keeps the previous single-pass review.
- Four cross-file bench cases (`cross-null-return`, `cross-unit-mismatch`, `cross-missing-await`, and the control `clean-cross-guard`). Each can only be judged by reading a file the change does not touch. The bench report records the mode (`agentic` or `quick`).

- Ollama Cloud and authenticated Ollama servers: when `OLLAMA_API_KEY` is set, OwnKey sends it as a bearer token (`ownkey config --provider ollama --endpoint https://ollama.com`). A rejected key now gives a clear message instead of a bare 401.
- First real-model bench results in the README (`gpt-oss:120b` and `gemma4:31b` on Ollama Cloud, agentic vs quick).

- Keeper, the OwnKey mascot: a living key with one inspecting eye. It reacts to what OwnKey is doing. Its eye darts across files on a live status line while a review investigates. It's alarmed when the review finds issues, smiles when the review is clean, and shows an × on errors. At the session prompt, it keeps the look of the last command. It resizes with the terminal (full, compact, one-line, or hidden) and redraws when the window is resized. It never appears in CI, pipes, or machine-readable output. `OWNKEY_REDUCED_MOTION=1` keeps it still and `OWNKEY_NO_MASCOT=1` hides it. There's also an animated `assets/keeper.svg` for the README, which respects `prefers-reduced-motion`.

### Fixed

- Findings are anchored on the line the model names. The output format now asks for `"line"`, and `line`, `lineNumber`, or `startLine` are accepted. Before, a finding without an exact diff fell back to the first changed line of its file, so a correct report could land on the wrong line in the review, in SARIF, and in bench scoring. On the bench this took `gpt-oss:120b` from 6 to 15 of 15 bugs caught: the model had been finding them all along.

### Changed

- The session's command menu fits narrow terminals: descriptions truncate instead of wrapping.
- Providers now expose `chat(system, messages)`. One-shot `analyze` is built on it. Ollama uses `/api/chat` for multi-turn conversations and `/api/generate` for single requests, as before.

## [1.3.0] - 2026-10-24

### Added

- Interactive session: run `ownkey` with no arguments in a project to open a prompt for that folder. The header shows the repository, branch, number of changed files, and the active provider and model. Commands are typed without the `ownkey` prefix, with Tab completion for commands and flags, a command menu, and persistent history in `~/.ownkey/history`. Commands run as child processes on the real terminal, so prompts, colors, and Ctrl+C behave exactly as in a shell.
- The session only starts for a person at a terminal. Pipes, scripts, CI (`CI` set), and `OWNKEY_NO_UI=1` keep the plain help output, and every subcommand is unchanged.

### Dependencies

- `ink` 5 and `react` 18 for the session UI. They are loaded only when the session starts, so scripted runs don't pay for them.

## [1.2.0] - 2026-10-24

### Added

- `ownkey bench`: measures review quality on 15 seeded cases (12 planted bugs across JavaScript, TypeScript, and Python, plus 3 correct changes as controls). Reports recall, precision, and false alarms on clean changes. Supports `--model` to compare models on the same key, `--format json|markdown`, `--output`, and `--min-recall` for CI gating. Runs in temporary repositories and stores nothing.

### Changed

- The review pipeline (change collection, file selection, model call) now lives in `src/core/review/run.ts`. Both `review` and `bench` use it, so the benchmark measures exactly what `review` does.

## [1.1.2] - 2026-10-23

### Documentation

- README opens with a short product demo (review, verified apply, PR gate) in place of the logo image. Source for the film is in `assets/film`.

## [1.1.1] - 2026-10-23

### Fixed

- CI: `package-lock.json` is now committed, so `npm ci` and dependency caching work. The test matrix (Node 18, 20, 22) runs from a clean install.

## [1.1.0] - 2026-10-23

OwnKey becomes a local-first AI code reviewer: review what changed, gate pull requests, and apply fixes that are verified before they stick.

### Added

- `ownkey review`: reviews staged changes, uncommitted work, or a branch against its base (`--base origin/main`). Sends full files for context and the diff as focus, and reports only on changed files.
- Report formats: `--format text|markdown|json|sarif`, plus `--sarif-output` and `--markdown-output` to write several in one run. SARIF 2.1.0 works with GitHub code scanning.
- `--fail-on <severity>` for CI gating (exit 1), with exit 2 when a review cannot run.
- `apply --verify "<command>"`: runs your tests or checks after each apply and reverts automatically on failure.
- `undo --last`: restores the most recent apply.
- GitHub Action (`action.yml`): reviews pull requests, posts or updates one summary comment, uploads SARIF, and gates on severity.
- Re-running a review reuses matching pending suggestions instead of duplicating them.

### Changed

- Default models updated to `gpt-6.1-sol`, `claude-sonnet-5-5`, `gemini-3.8-flash` and `qwen2.5-coder:latest`. Configured models are unchanged.
- Provider requests match current APIs: OpenAI reasoning-era models get `max_completion_tokens` with no `temperature` (with a one-time retry for compatible endpoints), Claude requests send no sampling parameters and read text after thinking blocks, and Gemini requests JSON output and ignores thought parts.

### Security

- The encrypted key file no longer uses a fixed built-in password. Keys are encrypted with a random per-install secret (`~/.ownkey/master.key`, mode 0600), and existing key files are migrated automatically on first read.

## [1.0.2] - 2026-10-23

### Documentation

- Rewrote the README: provider setup, full command and option reference, how apply and undo work, data locations, optional database, and CI usage.

No code changes from 1.0.1.

## [1.0.1] - 2026-10-23

### Fixed

- **Fresh installs:** `ownkey config` no longer fails with "No configuration found. Run: ownkey config". Commands that do not need a provider (scan, apply, undo) now run without one.
- **Ollama + apply:** Ollama uses the same prompt and JSON contract as the other providers, so its suggestions carry diffs and can be applied.
- **apply:** shows the diff and asks before writing (use `--auto` to skip); patches files in the project the suggestion was made for, from any folder; tolerates off-by-a-few line numbers and rejects hunks that do not match; creates new files (undo removes them); `--all` and `--severity` work; `ownkey apply` with no ID lists pending suggestions; re-applying is blocked.
- **Diff engine:** fixed a bug that inserted replacement lines one line too low; handles CRLF files and blank context lines.
- **Optional database:** connects with a Postgres/Supabase connection string (`--database-url`), ships its SQL migrations in the package, and applies every pending migration. Local-only mode no longer prints database warnings.
- **config:** validates providers and missing keys with clear errors, adds `--show`, `--endpoint`, `--no-database`, `--yes`; explains flags instead of crashing when there is no terminal.
- **undo:** `--yes` for scripts; never hangs without a terminal.
- Gemini connection test is real; repository links point to ArpitK24/ownkey.

### Added

- `--endpoint` for OpenAI-compatible APIs (OpenRouter, Groq, LM Studio, vLLM) and custom Ollama hosts.
- `OWNKEY_NO_KEYCHAIN=1` to store keys in the encrypted file instead of the OS keychain.
- Vitest suite: CLI smoke tests for every command against a mock Ollama server, diff/parsing unit tests, and an opt-in database test (`OWNKEY_TEST_DATABASE_URL`).

## [1.0.0] - 2026-01-25

### 🎉 Stable Release

First stable release of OwnKey CLI! Production-ready AI coding agent that works with or without a database.

### Added

- **Hybrid Storage System**
  - Local file storage in `~/.ownkey/storage/`
  - Works with OR without database
  - Automatic fallback if database fails
  - 7-day retention with auto-cleanup
  - Max 100 suggestions per project

- **Local-Only Mode**
  - Full functionality without database
  - Apply/undo work with local storage
  - Automatic backup management
  - No Supabase required

- **Multi-Provider Support**
  - Google Gemini (tested ✅)
  - Ollama (tested ✅)
  - OpenAI (tested ✅)
  - Anthropic Claude (tested ✅)

### Fixed

- UV handle errors causing crashes
- Database disconnection race condition
- Apply/undo requiring database
- Database save operation crashes
- Improved error handling

### Changed

- Apply engine now loads from local storage OR database
- Suggest command saves to both database and local file
- Database operations wrapped in try-catch with fallback
- Only disconnect database if connected

### Improved

- Stability in both local-only and database modes
- Error messages are clearer
- User experience is more polished
- Documentation updated

## [0.8.0] - 2026-01-24

### Added
- Ollama provider support (experimental)
- Local LLM integration
- Model auto-detection

### Fixed
- Various stability improvements

## [0.7.0] - 2026-01-23

### Added
- Apply system with automatic backups
- Undo functionality
- Interactive confirmation
- Diff preview

## [0.6.0] - 2026-01-22

### Added
- OpenAI provider support
- Anthropic Claude provider support
- Multi-provider architecture

## [0.5.0] - 2026-01-21

### Added
- Google Gemini integration
- AI-powered code analysis
- Suggestion generation

## [0.4.0] - 2026-01-20

### Added
- File scanner
- Project analysis
- .gitignore support

## [0.3.0] - 2026-01-19

### Added
- Configuration system
- Keychain integration
- Secure API key storage

## [0.2.0] - 2026-01-18

### Added
- CLI skeleton
- Basic commands
- Project structure

## [0.1.0] - 2026-01-17

### Added
- Initial release
- Project setup
