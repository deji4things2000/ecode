# 🤖 Advanced AI Agent — VS Code Extension

A sophisticated multi-agent AI system for VS Code that goes far beyond
standard code completion. Built with persistent memory, chain-of-thought
reasoning, parallel analysis, and a full suite of workspace tools.

---

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [Agent Types](#-agent-types)
- [Tool Registry](#-tool-registry)
- [Memory System](#-memory-system)
- [Keyboard Shortcuts](#-keyboard-shortcuts)
- [Source Tree](#-source-tree)
- [How It Works](#-how-it-works)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

### Multi-Agent Architecture
Unlike single-prompt AI tools, every request is routed to a
**specialist agent** best suited for the task:

| Agent | Capability |
|---|---|
| 🔍 Analysis | Deep code review — quality, security, performance in parallel |
| 🐛 Debug | Multi-step bug detection with structured bug reports and auto-fix |
| 🔧 Refactor | Strategy-first refactoring with diff preview and one-click apply |
| 🧪 Testing | Unit + integration + edge-case test suites generated in parallel |
| 🏗️ Architect | System design advice, patterns, migration paths, ASCII diagrams |
| 🤖 General | Free-form chat with full memory and workspace context |

### Chain-of-Thought Reasoning (ReAct)
Agents do not guess — they **reason in steps**:
THOUGHT     → internal planning 
ACTION      → what the agent will do 
OBSERVATION → what it found 
FINAL_ANSWER→ synthesised response 

Up to 4 reasoning iterations per task for thorough analysis.

### Persistent Memory
- Remembers conversations, code analyses, and project context
  **across VS Code sessions**
- Scores memories by relevance and importance
- Automatically evicts low-value memories when the limit is reached
- Retrieves the top-N most relevant memories before every response

### Workspace Tool Registry
22 built-in tools agents can call autonomously:
- Read / write / search files
- Insert and replace code in the active editor
- Query VS Code diagnostics
- Run git commands (diff, log, status)
- Find symbols across the workspace
- Format code, copy to clipboard, and more

### Dual AI Provider Support
- **OpenAI** — GPT-4o, GPT-4, GPT-3.5-Turbo
- **Anthropic** — Claude 3.5 Sonnet, Claude 3 Opus
- **Mock provider** — works with zero configuration for testing

### Rich Chat Interface
- Tabbed agent selector
- Animated reasoning indicator
- Syntax-highlighted code blocks with Copy + Apply buttons
- One-click suggestion chips
- Stats overlay (memory, tool usage, success rates)
- Tool browser panel
- Full markdown rendering including tables

### Inline Diagnostics
- AI-powered squiggles (errors / warnings / hints) in the editor
- Debounced scanning — triggers 2.5 s after you stop typing
- Quick Fix light-bulb with AI-generated fix text
- Integrated with the VS Code Problems panel

---


---

## 📦 Requirements

| Requirement | Version |
|---|---|
| VS Code | `^1.85.0` |
| Node.js | `^18.0.0` |
| npm | `^9.0.0` |
| TypeScript | `^5.3.0` |
| OpenAI API key | Optional (mock mode available) |
| Anthropic API key | Optional |

---

## 🚀 Installation

### Option A — Run from Source (Development)

```bash
# 1. Clone or create the project folder
mkdir advanced-ai-agent && cd advanced-ai-agent

# 2. Install dependencies
npm install

# 3. Compile TypeScript
npm run compile

# 4. Open VS Code in the project root
code .

# 5. Press F5 — a new Extension Development Host window opens
#    The extension is live inside that window

# Build the package
npm install -g vsce
vsce package

# Install in VS Code
# Extensions panel → ··· menu → Install from VSIX
# Select: advanced-ai-agent-1.0.0.vsix

