# OwnKey CLI

**Local-first AI coding agent for intelligent codebase analysis**

[![npm version](https://badge.fury.io/js/ownkey.svg)](https://www.npmjs.com/package/ownkey)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Quick Start

```bash
# Install globally
npm install -g ownkey

# Configure OwnKey
ownkey config

# Scan your project
ownkey scan .

# Get AI suggestions (coming in v0.5.0)
ownkey suggest .
```

## 📋 Features

- **Local-First**: Your code never leaves your machine
- **AI-Powered**: Intelligent analysis using OpenAI, Anthropic, or local LLMs
- **Privacy-First**: API keys stored securely in OS keychain
- **Database Integration**: Optional Supabase for history tracking
- **Smart Scanning**: Respects .gitignore and custom ignore patterns
- **Safe Changes**: Backup files before applying suggestions

## 🛠 Installation

### Via npm (Recommended)

```bash
npm install -g ownkey
```

### From Source

```bash
git clone https://github.com/yourusername/ownkey-cli.git
cd ownkey-cli
npm install
npm run build
npm link
```

## ⚙️ Configuration

Run the interactive configuration wizard:

```bash
ownkey config
```

Or use flags:

```bash
# Configure Supabase
ownkey config --supabase-url postgresql://... --supabase-key your-key

# Configure AI provider
ownkey config --provider openai --api-key sk-...
```

### Supported AI Providers

- **OpenAI** (GPT-4)
- **Anthropic** (Claude)
- **Ollama** (Local LLMs)

## 📖 Commands

### `ownkey config`

Configure Supabase database and AI providers.

```bash
ownkey config                    # Interactive wizard
ownkey config --reset            # Reset to defaults
```

### `ownkey scan [path]`

Scan a project directory.

```bash
ownkey scan .                    # Scan current directory
ownkey scan ./src                # Scan specific folder
ownkey scan --max-file-size 1mb  # Custom file size limit
```

### `ownkey suggest [path]` *(Coming in v0.5.0)*

Generate AI-powered suggestions.

```bash
ownkey suggest .
ownkey suggest --type security
ownkey suggest --severity high
```

### `ownkey apply <id>` *(Coming in v0.7.0)*

Apply a suggestion to your code.

```bash
ownkey apply abc123
ownkey apply abc123 --no-backup
```

## 🔒 Security

- **API Keys**: Stored in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- **Fallback**: Encrypted local storage if keychain unavailable
- **No Remote Storage**: Your source code is never uploaded to any server
- **Supabase**: Optional, user-controlled database for history only

## 🗂 Project Structure

```
~/.ownkey/
├── config.json       # Configuration file
├── keys.enc          # Encrypted API keys (fallback)
└── logs/             # Log files
```

## 🧪 Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Run tests
npm test
```

## 📝 Roadmap

- [x] v0.2.0 - CLI skeleton & configuration
- [x] v0.3.0 - Config system with keychain
- [x] v0.4.0 - File scanner
- [ ] v0.5.0 - AI provider integration
- [ ] v0.6.0 - Suggestion engine
- [ ] v0.7.0 - Apply/diff system
- [ ] v0.8.0 - Additional commands
- [ ] v0.9.0 - Testing & polish
- [ ] v1.0.0 - Stable release

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

## 📄 License

MIT © 2026 OwnKey

## 🔗 Links

- [Documentation](https://github.com/yourusername/ownkey-cli/wiki)
- [Issue Tracker](https://github.com/yourusername/ownkey-cli/issues)
- [npm Package](https://www.npmjs.com/package/ownkey)

---

**Note**: OwnKey is currently in active development. Features marked as "coming soon" are planned for upcoming releases.
