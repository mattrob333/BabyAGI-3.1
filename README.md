# BabyAGI 3.1

A production-hardened fork of [BabyAGI 3](https://github.com/yoheinakajima/babyagi3) with a Next.js web frontend, Telegram/Discord channel support, multi-provider web search, and one-command Fly.io deployment.

**Live demo**: [https://babyagi3.fly.dev](https://babyagi3.fly.dev)

## What's New in 3.1

### Web Frontend (`web/`)
Built a full Next.js 16 frontend (App Router, Tailwind v4, shadcn/ui) that provides:
- Real-time SSE streaming chat interface with tool call indicators
- Thread management (create, switch, clear conversations)
- Quick action chips for common tasks
- Setup wizard for first-run configuration
- Scheduled task management dashboard
- Memory browser and metrics viewer
- Mobile-optimized with virtual keyboard handling, sticky input, and touch-friendly controls

### Telegram & Discord Channels
- Fixed critical bug where both listeners called non-existent `agent.message()` - changed to `agent.run_async()`
- Telegram: message splitting for 4096 char limit, Markdown-to-plain-text fallback for tool output
- Discord: same fix pattern as Telegram
- Both configured via `config.yaml` with env var substitution

### Smart Web Search (Exa > Brave > DuckDuckGo)
- `web_search` tool now uses a fallback chain of search providers
- Exa semantic/neural search (best quality) if `EXA_API_KEY` is set
- Brave Search API as second tier if `BRAVE_API_KEY` is set
- DuckDuckGo as guaranteed free fallback (always available)

### Production Hardening
- **Security**: CORS restricted to configured origins, auth fails closed, server binds to 127.0.0.1 by default
- **Data integrity**: SQLite WAL mode + busy_timeout for concurrent access, atomic .env writes
- **Stability**: Centralized `Agent.shutdown()`, SIGTERM/SIGINT signal handlers, resource bounds (thread pool, LRU caches)
- **Bug fixes**: datetime naive/aware comparison crash, `eval()` replaced with `ast.literal_eval()`, O(n^2) context budget fix, scheduler atomic writes on Windows

### Deployment
- Multi-stage Dockerfile (Node frontend build + Python backend)
- `fly.toml` with persistent volume for data
- `start.sh` entrypoint that orchestrates backend + frontend startup
- `docker-compose.yml` for local testing

## Project Structure

```
BabyAGI3/
  babyagi3/           # Python backend (FastAPI, LiteLLM, SQLite memory)
    agent.py          # Core orchestrator (~2800 lines)
    server.py         # FastAPI with SSE streaming, webhooks
    scheduler.py      # at/every/cron task scheduling
    memory/           # 3-layer memory (event log, knowledge graph, summaries)
    tools/            # Tool framework with @tool decorator
    listeners/        # Input: CLI, email, Telegram, Discord, voice
    senders/          # Output: terminal, email, SMS
  web/                # Next.js 16 frontend
    app/              # App Router pages
    components/       # Chat UI, setup wizard, layout
    lib/              # SSE hooks, API client, types
  Dockerfile          # Multi-stage build
  fly.toml            # Fly.io deployment config
  start.sh            # Container entrypoint
  docker-compose.yml  # Local Docker testing
```

## Quick Start

### Local Development

```bash
# Backend
cd babyagi3
uv sync
export ANTHROPIC_API_KEY="sk-ant-..."  # or OPENAI_API_KEY / MOONSHOT_API_KEY
python main.py serve

# Frontend (separate terminal)
cd web
npm install
npm run dev
```

Open http://localhost:3000

### With Telegram

```bash
cd babyagi3
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_ENABLED=true
python main.py all  # Starts server + all channels
```

### Deploy to Fly.io

```bash
# Install Fly CLI, then:
fly launch --name your-app-name
fly volumes create babyagi_data --size 1 --region sjc
fly secrets set ANTHROPIC_API_KEY="sk-ant-..." TELEGRAM_BOT_TOKEN="..." BABYAGI_API_TOKEN="your-secret"
fly deploy
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes* | Anthropic Claude |
| `OPENAI_API_KEY` | Yes* | OpenAI (alternative) |
| `MOONSHOT_API_KEY` | Yes* | Kimi / Moonshot (alternative) |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Telegram bot |
| `DISCORD_BOT_TOKEN` | For Discord | Discord bot |
| `BABYAGI_API_TOKEN` | Recommended | API authentication |
| `EXA_API_KEY` | Optional | Exa semantic search |
| `BRAVE_API_KEY` | Optional | Brave Search API |
| `BROWSER_USE_API_KEY` | Optional | Browser automation |
| `BABYAGI_CORS_ORIGINS` | For deploy | Comma-separated allowed origins |

*At least one LLM API key is required.

## Architecture

```
Browser/Mobile -> Next.js (port 3000) -> rewrites -> FastAPI (port 5000) -> LiteLLM -> LLM API
Telegram Bot   -> python-telegram-bot -> agent.run_async() -> LLM API
Discord Bot    -> discord.py          -> agent.run_async() -> LLM API
```

The Next.js frontend proxies all API calls to the Python backend via rewrites, so both run in a single container on Fly.io with only port 3000 exposed.

## Based On

This is a fork of [BabyAGI 3](https://github.com/yoheinakajima/babyagi3) by [@yoheinakajima](https://x.com/yoheinakajima). The original backend code lives in `babyagi3/` - see its [README](babyagi3/README.md) for the full upstream documentation.

## License

MIT License. See [LICENSE](babyagi3/LICENSE).
