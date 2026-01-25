# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - OpenAI (supported)
  - Anthropic Claude (supported)

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
