# Changelog

All notable changes to this project will be documented in this file.

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
