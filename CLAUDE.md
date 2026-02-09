# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BabyAGI 3 is a minimal, configurable AI agent framework (Python >= 3.12) that orchestrates autonomous background work while maintaining a persistent conversation interface. Core principle: "Everything is a message." Built on LiteLLM for multi-provider LLM support (Anthropic Claude, OpenAI) with FastAPI for the HTTP API.

All source code lives under `babyagi3/`.

## Commands

### Setup & Install
```bash
cd babyagi3
uv sync              # Install dependencies
uv sync --group dev  # Install with dev/test dependencies
```

### Running
```bash
cd babyagi3
python main.py              # CLI mode (default)
python main.py serve        # API server only (port 5000)
python main.py serve 8080   # API server on custom port
python main.py channels     # All listeners, no webhook server
python main.py all          # Server + all channels
python main.py init         # Re-run interactive setup wizard
```

### Testing
```bash
cd babyagi3
uv run pytest -q                           # Run all tests
uv run pytest tests/test_scheduler.py -q   # Run a single test file
uv run pytest tests/test_agent.py -k "test_name" -q  # Run a specific test
```

Tests are in `babyagi3/tests/` (17 files). Fixtures in `conftest.py` provide temp directories, mock API keys, and a `clean_env` fixture that isolates LLM-related env vars.

### Verbose Output
Control via `BABYAGI_VERBOSE` env var or `config.yaml`, or at runtime with `/verbose [off|light|deep]`.

## Architecture

### Core Loop
```
Input Listener -> Agent.run_async() -> LLM API -> Tool Execution -> Output Sender
```

### Key Components

**Agent** (`agent.py`, ~2800 lines) - Central orchestrator. Manages conversation threads (dict keyed by thread_id), background objectives, tool registry, and event emission. Thread-safe with per-thread locks.

**Memory System** (`memory/`) - Three layers:
- Layer 1: Event log (immutable messages with timestamps)
- Layer 2: Knowledge graph (entities, relationships, topics extracted via LLM)
- Layer 3: Hierarchical summaries (staleness-aware refresh)
- `store.py` is the SQLite backend and the largest file in the codebase

**Scheduler** (`scheduler.py`) - Supports `at` (one-time), `every` (interval: 5m, 2h, 1d), and `cron` (5-field expressions with timezone via croniter).

**Tools** (`tools/`) - Decorator-based with auto JSON schema generation from type hints:
```python
@tool(packages=["pandas"], env=["API_KEY"])
def my_tool(query: str, limit: int = 10) -> dict:
    """Does something useful."""
    return {"result": "..."}
```
Built-in tools: memory, objectives, notes, schedule, send_message, web_search, browse, email, code sandbox. Optional: 250+ via Composio.

**Multi-Channel I/O:**
- Listeners (input): `listeners/` - CLI REPL, email poller, voice transcription, SendBlue
- Senders (output): `senders/` - terminal, email, SMS/iMessage
- Server: `server.py` - FastAPI with webhooks for external integrations

### Key Patterns

- **EventEmitter mixin** (`utils/events.py`) - Pub/sub for tool_start/end, objective events
- **ThreadSafeList** (`utils/collections.py`) - Protects shared MEMORIES and NOTES
- **Context budget management** (`context_budget.py`) - Tracks tokens, summarizes large tool results to prevent overflow
- **Graceful degradation** - SQLite memory, voice, meeting tools all optional; auto-skip if deps missing

## Configuration

YAML-based (`config.yaml`) with `${VAR_NAME:default}` environment variable substitution.

Key env vars: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (required), `AGENTMAIL_API_KEY`, `SENDBLUE_API_KEY`/`SENDBLUE_API_SECRET`, `E2B_API_KEY`.

LLM config defines per-use-case models: `coding_model`, `research_model`, `agent_model`, `memory_model`, `fast_model` - each with model name, max_tokens, temperature.

## Reference Documentation

- `ARCHITECTURE.md` - Mermaid diagrams for system flow, memory, tools, scheduler, events
- `MODELS.md` - Complete data model reference (Objective, Tool, Schedule, Event, Entity)
- `RUNNING.md` - Detailed examples for each execution mode
- `memory/README.md`, `tools/README.md`, `listeners/README.md`, `senders/README.md` - Subsystem docs
