# Quantum Agent

Multi-provider AI agent with adaptive possibility engine, quota-aware failover, auto-resume, and MCP support.

## Features

- 🌐 **Multi-provider** — OpenAI, Claude, Gemini, Ollama, any OpenAI-compatible API
- 🔍 **Model discovery** — lists every available model per provider
- 🔌 **Connect models** — pick which model each provider uses
- 🔁 **Smart failover** — provider fails → next provider tries automatically
- ⏸️ **Quota-aware** — 429/402 detected → pause + auto-resume when window reopens
- 💾 **Restart-safe** — checkpoints, resume paused tasks after restart
- 🎯 **Exact-answer gate** — stops only when answer verified (or max runtime)
- 🤖 **MCP server** — works with Claude Desktop, Cursor, VS Code, Zed
- 💻 **Full CLI** — full control from terminal/Termux

## Install

```bash
git clone https://github.com/k4878337-lang/quantum-agent.git
cd quantum-agent
pnpm install # or npm install
pnpm run build
```

Link CLI globally:
```bash
npm link # or pnpm link --global
```

Now `qa` is available globally.

## Quick Start

```bash
# 1. Add providers (API keys prompted)
qa add -t gemini -n "Gemini"
qa add -t claude -n "Claude"
qa add -t openai -n "GPT"

# 2. List every available model
qa models

# 3. Connect (interactive model picker)
qa connect gemini-gemini

# OR auto-connect all with best default
qa connect-all

# 4. Ask anything
qa ask "Explain Grover's algorithm"

# 5. Long-running task (background-capable)
qa run "Solve this complex problem" --background

# 6. Status, resume, manage
qa status
qa resume
qa list
qa remove openai-gpt
```

## Commands

| Command | Purpose |
|---|---|
| `qa add` | Add provider with API key |
| `qa models` | ⭐ List all available models from all providers |
| `qa connect <id> [model]` | ⭐ Pick model for provider (interactive) |
| `qa connect-all` | ⭐ Auto-connect all with best defaults |
| `qa list` | Show providers + their connected model |
| `qa ask <prompt>` | One-shot question |
| `qa run <question>` | Full brain loop, failover, quota-aware |
| `qa status` | Environment, quota, paused tasks |
| `qa resume` | Resume all paused tasks |
| `qa remove <id>` | Remove provider |
| `qa enable/disable <id>` | Toggle provider |

## MCP Client Config

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "quantum-agent": {
      "command": "node",
      "args": ["/absolute/path/to/quantum-agent/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. You'll see `quantum-reason`, `list-providers`, `brain-status` tools.

## Environment Detection

- **AI chat** (MCP stdio) → uses pre-configured providers
- **Linux/Termux terminal** → interactive setup if no providers
- **Background mode** → detached process

## File Storage

All state in project root:

- `.quantum-providers.json` — provider configs (chmod 600)
- `.quantum-quota.json` — per-provider cooldown state
- `.quantum-checkpoints/` — task state for resume

## Safety

- API keys stored locally only (`chmod 600`)
- No telemetry
- No cloud logging
- MIT License

## License

MIT
