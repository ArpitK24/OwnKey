# OwnKey CLI

> AI-powered code analysis that works with or without a database

[![npm version](https://img.shields.io/npm/v/ownkey.svg)](https://www.npmjs.com/package/ownkey)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**OwnKey** is a local-first AI coding agent that analyzes your codebase and provides intelligent suggestions for bugs, security issues, performance improvements, and code quality.

🌐 **[Full Documentation](https://ownkey.qzz.io)**

## ✨ Features

- 🤖 **Multi-Provider AI** - Supports Google Gemini, OpenAI, Anthropic Claude, and Ollama
- 🔒 **Privacy-First** - Works completely offline with local-only mode
- 💾 **Optional Database** - Supabase integration for persistent history (optional)
- 🚀 **Auto-Model Detection** - Instantly supports new AI models without CLI updates
- 🎯 **Smart Suggestions** - Identifies bugs, security issues, performance problems, and more
- ⚡ **Apply & Undo** - Safely apply suggestions with automatic backups

## 🚀 Quick Start

### Installation

```bash
npm install -g ownkey
```

### Basic Usage

```bash
# Configure with your AI provider
ownkey config --provider gemini --api-key YOUR_API_KEY

# Analyze your code
ownkey suggest .

# Apply a suggestion
ownkey apply local-123456789-0

# Undo if needed
ownkey undo
```

### Local-Only Mode

No database required! OwnKey automatically stores suggestions in `~/.ownkey/storage/`:

```bash
ownkey suggest . --local-only
```

### With Database (Optional)

For persistent history across devices:

```bash
ownkey config --supabase-url YOUR_URL --supabase-key YOUR_KEY
ownkey suggest .
```

## 📚 Documentation

Visit **[ownkey.qzz.io](https://ownkey.qzz.io)** for complete documentation:

- [Getting Started](https://ownkey.qzz.io/docs/getting-started)
- [AI Providers Setup](https://ownkey.qzz.io/docs/providers)
- [Commands Reference](https://ownkey.qzz.io/docs/commands)
- [Database Setup](https://ownkey.qzz.io/docs/database)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT © [OwnKey](https://ownkey.qzz.io)

---

**[Website](https://ownkey.qzz.io)** • **[Documentation](https://ownkey.qzz.io/docs)** • **[GitHub](https://github.com/ArpitK24/ownkey-cli)**
