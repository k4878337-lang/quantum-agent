# Quantum Agent

Multi-provider AI agent with quota-aware failover, atomic checkpointing, and MCP server support.

## Status — Honest

- **Phase 3 (current)**: Provider orchestration + safety + persistence. All 18 audited bugs fixed with tests.
- **Phase 4 (future)**: Adaptive branch engine, independent verifier, multi-agent execution. NOT implemented yet.

Do not treat `weak-heuristic` results as verified. Only `verified` results (Phase 4) will be `status=done`.

## Install

```bash
git clone https://github.com/YOUR_USERNAME/quantum-agent.git
cd quantum-agent
npm install
npm run build
npm link
```

## Quick Start

```bash
qa add -t deepseek -n "DeepSeek"     # prompts for key
qa add -t gemini -n "Gemini"
qa models
qa connect-all
qa ask "What is 2+2?"
```

## Commands

| Command | Purpose |
|---|---|
| `qa add` | Add provider (key prompt, no shell history leak) |
| `qa models` | List all models from all enabled providers |
| `qa connect <id> [model]` | Pick model interactively or directly |
| `qa connect-all` | Auto-connect with best defaults |
| `qa list` | Show providers (API keys redacted) |
| `qa ask <prompt>` | One-shot (uses weak-heuristic gate — status=candidate) |
| `qa run <question> --hours 24` | Full brain loop with failover + quota pause |
| `qa status` | Environment + quota + paused tasks |
| `qa resume` | Resume all paused tasks |
| `qa remove <id>` | Remove provider |

## Supported providers

`openai`, `claude`, `gemini`, `deepseek`, `ollama`, `custom` (OpenAI-compatible).

## MCP Client Config

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

## Safety model

- API keys stored in `.quantum-providers.json` (chmod 600, gitignored)
- ScopeGuard for authorized scans: strict URL matching, redirect revalidation, private IP blocking
- Checkpoints signed with HMAC-SHA256 + SHA-256 checksum, atomic write + parent fsync
- Task locks prevent duplicate execution
- MCP responses never include raw API keys

## CI

`.github/workflows/ci.yml` runs build + tests on push. If GitHub PAT lacks `workflow` scope, either:
1. Add `workflow` scope to PAT, or
2. Add the workflow file via GitHub web UI.

**Do not delete the workflow to bypass this.** Automated protection is required.

## Tests

```bash
npm test
```

All tests use mocked HTTP and isolated temp directories. Zero real API credits.

## License

MIT
