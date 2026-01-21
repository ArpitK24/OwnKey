<div align="center">

<img src="assets/logo.png" alt="OwnKey Logo" width="600"/>

# OwnKey

**Privacy-First AI Coding Agent**

[![npm version](https://badge.fury.io/js/ownkey.svg)](https://www.npmjs.com/package/ownkey)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Downloads](https://img.shields.io/npm/dm/ownkey.svg)](https://www.npmjs.com/package/ownkey)

*Intelligent code analysis powered by OpenAI, Anthropic Claude 4.5, and Google Gemini • Your code never leaves your machine*

[Quick Start](#-quick-start) • [Features](#-features) • [Installation](#-installation) • [Documentation](#-commands)

</div>

---

> ✨ **v0.6.0** - Multi-provider support! Choose between OpenAI, Anthropic Claude 4.5, and Google Gemini.

## 🚀 Quick Start

```bash
# Install globally
npm install -g ownkey

# Configure with your preferred AI provider
ownkey config --provider gemini --api-key YOUR_GEMINI_KEY
# OR
ownkey config --provider openai --api-key YOUR_OPENAI_KEY
# OR
ownkey config --provider anthropic --api-key YOUR_ANTHROPIC_KEY

# Analyze your codebase
ownkey suggest .
```

**Get API Keys:**
- **Gemini:** [Google AI Studio](https://aistudio.google.com/app/apikey) (Free tier available)
- **OpenAI:** [OpenAI Platform](https://platform.openai.com/api-keys)
- **Anthropic:** [Anthropic Console](https://console.anthropic.com/)

## ✨ Features

<table>
<tr>
<td width="50%">

### 🤖 Multi-Provider AI
Choose between OpenAI, Claude 4.5, or Gemini

### 🔒 Privacy-First
Your code never leaves your machine - all analysis is local

### 💾 Optional Cloud Sync
Store history in your own Supabase database

</td>
<td width="50%">

### 🔐 Secure Storage
API keys stored in OS keychain or encrypted

### 📂 Smart Scanning
Respects .gitignore and custom patterns

### 🎯 15+ AI Models
GPT-4, Claude Opus 4.5, Gemini 2.5, and more

</td>
</tr>
</table>

## ⚡ AI Provider Support

<div align="center">

| Provider | Status | Models | Get API Key |
|:--------:|:------:|:------:|:-----------:|
| **🟢 Google Gemini** | ✅ **Available** | Gemini 2.5 Pro, Flash, 2.0 | [Get Key](https://aistudio.google.com/app/apikey) |
| **🔵 OpenAI** | ✅ **Available** | GPT-4 Turbo, GPT-4, GPT-3.5 | [Get Key](https://platform.openai.com/api-keys) |
| **🟣 Anthropic** | ✅ **Available** | Claude Opus 4.5, Sonnet 4.5, Haiku 4.5 | [Get Key](https://console.anthropic.com/) |
| **🟠 Ollama** | 🔜 Coming Soon | Any local model | v0.7.0 |

**New in v0.6.0:** Multi-provider support with 15+ AI models!

</div>

## 🛠 Installation

### Via npm (Recommended)

```bash
npm install -g ownkey
```

### From Source

```bash
git clone https://github.com/ArpitK24/OwnKey.git
cd ownkey-cli
npm install
npm run build
npm link
```

## ⚙️ Configuration

### Interactive Setup

```bash
ownkey config
```

### Using Flags

```bash
# Configure Gemini
ownkey config --provider gemini --api-key YOUR_GEMINI_API_KEY

# Optional: Configure Supabase for history tracking
ownkey config --supabase-url https://xxx.supabase.co --supabase-key YOUR_KEY

# Use different Gemini model
ownkey config --provider gemini --model gemini-2.5-flash
```

### Getting a Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a new API key
3. Run `ownkey config --provider gemini --api-key YOUR_KEY`

## 📖 Commands

### `ownkey config`

Configure Supabase database and AI providers.

```bash
ownkey config                    # Interactive wizard
ownkey config --reset            # Reset to defaults
ownkey config --provider gemini --api-key YOUR_KEY
```

### `ownkey scan [path]`

Scan a project directory.

```bash
ownkey scan .                    # Scan current directory
ownkey scan ./src                # Scan specific folder
ownkey scan --max-file-size 1mb  # Custom file size limit
ownkey scan --ignore "*.test.js" # Additional ignore patterns
```

### `ownkey suggest [path]`

Generate AI-powered code suggestions.

```bash
ownkey suggest .                 # Analyze current directory
ownkey suggest ./src             # Analyze specific folder
ownkey suggest --max-files 20    # Limit files analyzed
ownkey suggest --local-only      # Skip database storage
```

**Output:**
```
🔍 Analyzing code...

[1] bug (high) in src/auth.ts
    Potential null pointer dereference

[2] security (critical) in db/query.ts
    SQL injection vulnerability detected

✨ Analysis Complete!
  Total suggestions: 12
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
- [x] **v0.5.0 - Gemini AI integration** ← Current
- [ ] v0.6.0 - OpenAI & Anthropic providers
- [ ] v0.7.0 - Apply/diff system
- [ ] v0.8.0 - Ollama (local LLM) support
- [ ] v0.9.0 - Testing & polish
- [ ] v1.0.0 - Stable release

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT © 2026 OwnKey

## 🔗 Links

- [GitHub Repository](https://github.com/ArpitK24/OwnKey)
- [Issue Tracker](https://github.com/ArpitK24/OwnKey/issues)
- [npm Package](https://www.npmjs.com/package/ownkey)
- [Get Gemini API Key](https://aistudio.google.com/app/apikey)

---

**Built with ❤️ for developers who value privacy and AI-powered productivity**
