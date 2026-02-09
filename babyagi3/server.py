"""
API Server for the Agent

Provides HTTP endpoints for:
- Receiving messages (webhooks)
- SendBlue SMS/iMessage webhooks
- Checking objective status
- Managing threads

This enables external systems to interact with the agent via HTTP.
"""

import asyncio
import json
import logging
import os
import time
from collections import OrderedDict
from datetime import datetime
from hmac import compare_digest
from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath
from typing import Optional

from fastapi import FastAPI, BackgroundTasks, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
from pydantic import BaseModel

from agent import Agent, Objective
from utils.console import console

logger = logging.getLogger(__name__)


def _get_request_host(request: Request) -> str:
    """Extract host from request URL, stripping IPv6 brackets."""
    host = (request.url.hostname or "").strip().lower()
    return host[1:-1] if host.startswith("[") and host.endswith("]") else host


def _is_local_host(host: str) -> bool:
    """True when host points to a local development interface."""
    return host in {"", "localhost", "127.0.0.1", "::1"}


def _api_auth_enabled(request: Request) -> bool:
    """Determine whether API auth should be enforced for this request.

    BABYAGI_API_AUTH can be set to:
    - "true"/"1"/"yes"/"on": always enforce
    - "false"/"0"/"no"/"off": never enforce
    - unset or "auto": enforce when host is not localhost
    """
    mode = os.environ.get("BABYAGI_API_AUTH", "auto").strip().lower()
    if mode in {"1", "true", "yes", "on"}:
        return True
    if mode in {"0", "false", "no", "off"}:
        return False

    host = _get_request_host(request)
    return not _is_local_host(host)


# =============================================================================
# Shared Agent Instance
# =============================================================================

agent = Agent()
scheduler_task: asyncio.Task | None = None


def _register_server_senders():
    """Register senders for webhook replies."""
    # SendBlue sender (for auto-reply to webhook messages)
    if os.environ.get("SENDBLUE_API_KEY") and os.environ.get("SENDBLUE_API_SECRET"):
        try:
            from senders.sendblue import SendBlueSender
            sendblue_config = {
                "api_key": os.environ.get("SENDBLUE_API_KEY"),
                "api_secret": os.environ.get("SENDBLUE_API_SECRET"),
                "from_number": os.environ.get("SENDBLUE_PHONE_NUMBER"),
            }
            agent.register_sender("sendblue", SendBlueSender(sendblue_config))
            logger.debug("SendBlue sender registered for webhooks")
        except Exception as e:
            logger.error(f"Failed to register SendBlue sender: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start scheduler on startup, register senders, clean up on shutdown."""
    global scheduler_task
    _register_server_senders()
    scheduler_task = asyncio.create_task(agent.run_scheduler())
    logger.debug("Server started with SendBlue webhook at /webhooks/sendblue")
    yield
    if scheduler_task:
        scheduler_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Agent API",
    description="HTTP interface for the agent with background objectives",
    lifespan=lifespan
)

# CORS — allow the web frontend to access the API
_cors_origins_env = os.environ.get("BABYAGI_CORS_ORIGINS", "")
_cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()] if _cors_origins_env else ["http://localhost:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def api_auth_middleware(request: Request, call_next):
    """Protect HTTP API endpoints with token auth when enabled.

    Bypasses auth for /setup/* when the system is not yet initialized,
    and for /health which is used for connectivity checks.
    """
    # Always allow health checks and CORS preflight
    if request.url.path == "/health" or request.method == "OPTIONS":
        return await call_next(request)

    # Bypass auth for /setup/* when not initialized
    if request.url.path.startswith("/setup"):
        from initialization import INIT_MARKER
        if not INIT_MARKER.exists():
            return await call_next(request)

    if not _api_auth_enabled(request):
        return await call_next(request)

    expected_token = os.environ.get("BABYAGI_API_TOKEN", "").strip()
    if not expected_token:
        # Fail closed: if auth is enabled but no token configured, reject
        raise HTTPException(status_code=401, detail="API auth enabled but BABYAGI_API_TOKEN not configured. Set the token or disable auth.")

    auth_header = (request.headers.get("authorization") or "").strip()
    bearer_token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    header_token = (request.headers.get("x-api-token") or "").strip()
    provided_token = bearer_token or header_token

    if not provided_token or not compare_digest(provided_token, expected_token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    return await call_next(request)


# =============================================================================
# Request/Response Models
# =============================================================================

class MessageRequest(BaseModel):
    """Incoming message (user input or webhook payload)."""
    content: str
    thread_id: str = "main"
    async_mode: bool = False  # If true, return immediately and process in background


class MessageResponse(BaseModel):
    """Response to a message."""
    response: str | None = None
    thread_id: str
    queued: bool = False  # True if processing in background


class ObjectiveResponse(BaseModel):
    """Objective details."""
    id: str
    goal: str
    status: str
    schedule: str | None
    result: str | None
    error: str | None


class SendBlueWebhookPayload(BaseModel):
    """SendBlue webhook payload for inbound messages.

    See: https://docs.sendblue.com/getting-started/webhooks/
    """
    message_handle: Optional[str] = None
    from_number: Optional[str] = None
    to_number: Optional[str] = None
    content: Optional[str] = None
    media_url: Optional[str] = None
    date_sent: Optional[str] = None
    date_created: Optional[str] = None
    is_outbound: Optional[bool] = False
    was_downgraded: Optional[bool] = None
    status: Optional[str] = None
    error_code: Optional[int] = None
    error_message: Optional[str] = None
    # Additional fields that may be present
    account_email: Optional[str] = None
    group_id: Optional[str] = None


# =============================================================================
# Recall.ai Webhook Models
# =============================================================================

class RecallTranscriptWord(BaseModel):
    """A word in the transcript."""
    text: str
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    confidence: Optional[float] = None


class RecallTranscriptData(BaseModel):
    """Real-time transcript data from Recall.ai."""
    bot_id: Optional[str] = None
    transcript: Optional[dict] = None
    # Transcript contains: speaker, speaker_id, words[], is_final


class RecallBotStatusChange(BaseModel):
    """Bot status change webhook from Recall.ai."""
    event: Optional[str] = None  # "bot.status_change"
    data: Optional[dict] = None
    # data contains: bot_id, status, status_changes[]


class RecallTranscriptDone(BaseModel):
    """Transcript done webhook from Recall.ai."""
    event: Optional[str] = None  # "transcript.done"
    data: Optional[dict] = None
    # data contains: bot_id, transcript_id


# =============================================================================
# Endpoints
# =============================================================================

@app.post("/message", response_model=MessageResponse)
async def receive_message(req: MessageRequest, background_tasks: BackgroundTasks):
    """
    Receive a message and process it.

    This is the main endpoint for:
    - User chat messages
    - Webhooks from external services
    - Automated triggers

    If async_mode=true, queues the message and returns immediately.
    """
    if req.async_mode:
        background_tasks.add_task(agent.run_async, req.content, req.thread_id)
        return MessageResponse(thread_id=req.thread_id, queued=True)

    response = await agent.run_async(req.content, req.thread_id)
    return MessageResponse(response=response, thread_id=req.thread_id)


@app.get("/objectives")
async def list_objectives() -> list[ObjectiveResponse]:
    """List all objectives and their status."""
    return [
        ObjectiveResponse(
            id=obj.id,
            goal=obj.goal,
            status=obj.status,
            schedule=obj.schedule,
            result=obj.result,
            error=obj.error
        )
        for obj in agent.objectives.values()
    ]


@app.get("/objectives/{objective_id}")
async def get_objective(objective_id: str) -> ObjectiveResponse:
    """Get details of a specific objective."""
    obj = agent.objectives.get(objective_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Objective not found")

    return ObjectiveResponse(
        id=obj.id,
        goal=obj.goal,
        status=obj.status,
        schedule=obj.schedule,
        result=obj.result,
        error=obj.error
    )


@app.get("/threads")
async def list_threads():
    """List all threads with metadata."""
    threads = []
    for tid, msgs in agent.threads.items():
        if not msgs:
            continue
        # Extract preview from last message
        last_msg = msgs[-1] if msgs else None
        preview = ""
        if last_msg:
            content = last_msg.get("content", "")
            if isinstance(content, list):
                preview = " ".join(
                    b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
                )[:100]
            elif isinstance(content, str):
                preview = content[:100]
        # Extract title from first user message
        title = tid
        for m in msgs:
            if m.get("role") == "user":
                c = m.get("content", "")
                if isinstance(c, str):
                    title = c[:60]
                elif isinstance(c, list):
                    title = " ".join(
                        b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text"
                    )[:60]
                break
        threads.append({
            "id": tid,
            "title": title,
            "message_count": len(msgs),
            "preview": preview,
        })
    return {"threads": threads}


@app.get("/threads/{thread_id}")
async def get_thread(thread_id: str):
    """Get message history for a thread."""
    return {"thread_id": thread_id, "messages": agent.get_thread(thread_id)}


@app.delete("/threads/{thread_id}")
async def clear_thread(thread_id: str):
    """Clear a thread's message history."""
    agent.clear_thread(thread_id)
    return {"cleared": thread_id}


@app.get("/health")
async def health(request: Request):
    """Health check endpoint."""
    # Check if authenticated for detailed info
    expected_token = os.environ.get("BABYAGI_API_TOKEN", "").strip()
    auth_header = (request.headers.get("authorization") or "").strip()
    bearer_token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    header_token = (request.headers.get("x-api-token") or "").strip()
    is_authed = expected_token and compare_digest(bearer_token or header_token or "", expected_token)

    if not expected_token or is_authed:
        return {
            "status": "ok",
            "objectives_count": len(agent.objectives),
            "threads_count": len(agent.threads),
            "tools": list(agent.tools.keys())
        }
    return {"status": "ok"}


# =============================================================================
# SSE Streaming Endpoint
# =============================================================================

@app.post("/message/stream")
async def stream_message(req: MessageRequest):
    """Stream agent response with real-time tool events via SSE.

    Emits SSE events:
        thinking     - {"status": "started"}
        text_delta   - {"text": str}  (token-by-token streaming)
        text_clear   - {}  (clear streaming text before next LLM call)
        tool_start   - {"name": str, "input": str}
        tool_end     - {"name": str, "result": str, "duration_ms": int}
        message_done - {"response": str, "thread_id": str}
        error        - {"error": str}
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    loop = asyncio.get_running_loop()

    def _enqueue(item: tuple):
        """Thread-safe enqueue: works from both event loop and worker threads."""
        try:
            queue.put_nowait(item)
        except asyncio.QueueFull:
            pass

    def _sse_handler(data: dict):
        event_type = data.get("_event", "")
        if event_type == "tool_start":
            payload = {"name": data.get("name", ""), "input": str(data.get("input", ""))[:500]}
            loop.call_soon_threadsafe(_enqueue, ("tool_start", payload))
        elif event_type == "tool_end":
            result_str = str(data.get("result", ""))
            if len(result_str) > 1000:
                result_str = result_str[:1000] + "... (truncated)"
            payload = {
                "name": data.get("name", ""),
                "result": result_str,
                "duration_ms": data.get("duration_ms", 0),
            }
            loop.call_soon_threadsafe(_enqueue, ("tool_end", payload))
        elif event_type == "text_delta":
            payload = {"text": data.get("text", "")}
            loop.call_soon_threadsafe(_enqueue, ("text_delta", payload))
        elif event_type == "text_clear":
            loop.call_soon_threadsafe(_enqueue, ("text_clear", {}))
        elif event_type in ("objective_start", "objective_end"):
            payload = {"goal": data.get("goal", ""), "status": data.get("status", "")}
            loop.call_soon_threadsafe(_enqueue, (event_type, payload))

    agent.on("*", _sse_handler)

    async def generate():
        # Immediately tell the frontend we're thinking
        yield f"event: thinking\ndata: {json.dumps({'status': 'started'})}\n\n"

        task = asyncio.create_task(
            agent.run_async(req.content, req.thread_id, stream=True)
        )
        try:
            while not task.done():
                try:
                    event_type, payload = await asyncio.wait_for(queue.get(), timeout=1.0)
                    yield f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive so the browser doesn't drop the connection
                    yield f": keepalive\n\n"
                    continue

            # Drain remaining events
            while not queue.empty():
                event_type, payload = queue.get_nowait()
                yield f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"

            response = task.result()
            done_payload = {"response": response or "", "thread_id": req.thread_id}
            yield f"event: message_done\ndata: {json.dumps(done_payload)}\n\n"

        except asyncio.CancelledError:
            # Client disconnected - cancel the agent task too
            if not task.done():
                task.cancel()
            raise
        except GeneratorExit:
            # Client disconnected
            if not task.done():
                task.cancel()
        except Exception as e:
            logger.error(f"SSE stream error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        finally:
            agent.off("*", _sse_handler)

    return StreamingResponse(generate(), media_type="text/event-stream")


# =============================================================================
# Setup Endpoints
# =============================================================================

class SetupCompleteRequest(BaseModel):
    """Setup form data from the web frontend."""
    owner_name: str
    owner_email: str
    owner_bio: str = ""
    owner_goal: str = ""
    owner_phone: str = ""
    owner_timezone: str = ""
    agent_name: str = "Assistant"
    agentmail_api_key: str = ""
    sendblue_api_key: str = ""
    sendblue_api_secret: str = ""
    sendblue_phone_number: str = ""
    composio_api_key: str = ""


@app.get("/setup/status")
async def setup_status():
    """Check if BabyAGI has been initialized and return current config."""
    from initialization import INIT_MARKER, _detect_existing_config
    return {
        "initialized": INIT_MARKER.exists(),
        "config": _detect_existing_config(agent.config if hasattr(agent, 'config') else {}),
    }


@app.post("/setup/complete")
async def setup_complete(req: SetupCompleteRequest):
    """Apply setup configuration from the web frontend."""
    from initialization import _apply_init_result, _save_init_state, _write_marker

    result = req.model_dump()
    config = agent.config if hasattr(agent, 'config') else {}

    _apply_init_result(config, result)
    _save_init_state(result)
    _write_marker(result)

    return {"status": "ok", "message": "Setup complete"}


# =============================================================================
# Scheduler / Tasks Endpoints
# =============================================================================

@app.get("/scheduler/tasks")
async def list_scheduled_tasks(include_disabled: bool = False):
    """List all scheduled tasks with their status."""
    tasks = agent.scheduler.list(include_disabled=include_disabled)
    return {
        "tasks": [
            {
                "id": t.id,
                "name": t.name,
                "goal": t.goal,
                "schedule": t.schedule.human_readable(),
                "schedule_raw": {
                    "kind": t.schedule.kind,
                    "at": t.schedule.at,
                    "every": t.schedule.every,
                    "cron": t.schedule.cron,
                    "tz": t.schedule.tz,
                },
                "enabled": t.enabled,
                "next_run_at": t.next_run_at,
                "last_run_at": t.last_run_at,
                "last_status": t.last_status,
                "last_error": t.last_error,
                "run_count": t.run_count,
                "created_at": t.created_at,
            }
            for t in tasks
        ]
    }


@app.get("/scheduler/tasks/{task_id}")
async def get_scheduled_task(task_id: str):
    """Get details of a specific scheduled task."""
    task = agent.scheduler.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        "id": task.id,
        "name": task.name,
        "goal": task.goal,
        "schedule": task.schedule.human_readable(),
        "schedule_raw": {
            "kind": task.schedule.kind,
            "at": task.schedule.at,
            "every": task.schedule.every,
            "cron": task.schedule.cron,
            "tz": task.schedule.tz,
        },
        "enabled": task.enabled,
        "next_run_at": task.next_run_at,
        "last_run_at": task.last_run_at,
        "last_status": task.last_status,
        "last_error": task.last_error,
        "last_duration_ms": task.last_duration_ms,
        "run_count": task.run_count,
        "created_at": task.created_at,
        "thread_id": task.thread_id,
    }


@app.get("/scheduler/tasks/{task_id}/history")
async def get_task_history(task_id: str, limit: int = 20):
    """Get execution history for a scheduled task."""
    task = agent.scheduler.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    runs = agent.scheduler.get_runs(task_id, limit=limit)
    return {
        "task_id": task_id,
        "runs": [
            {
                "started_at": r.started_at,
                "completed_at": r.completed_at,
                "status": r.status,
                "result": r.result,
                "error": r.error,
                "duration_ms": r.duration_ms,
            }
            for r in runs
        ],
    }


@app.post("/scheduler/tasks/{task_id}/run")
async def trigger_task(task_id: str):
    """Manually trigger a scheduled task."""
    task = agent.scheduler.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not agent._spawn_background_task(agent.scheduler.run_now(task_id, force=True)):
        raise HTTPException(status_code=500, detail="Agent not initialized")
    return {"status": "triggered", "task_id": task_id, "task_name": task.name}


class TaskUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    name: Optional[str] = None


@app.patch("/scheduler/tasks/{task_id}")
async def update_scheduled_task(task_id: str, req: TaskUpdateRequest):
    """Update a scheduled task (enable/disable, rename)."""
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    task = agent.scheduler.update(task_id, **updates)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "updated", "task_id": task_id, "enabled": task.enabled, "name": task.name}


# =============================================================================
# Tools / Integrations Endpoint
# =============================================================================

@app.get("/tools")
async def list_tools():
    """List all registered tools with metadata."""
    tools_list = []
    for name, tool in agent.tools.items():
        tool_info = {
            "name": name,
            "description": getattr(tool, "description", ""),
            "type": getattr(tool, "type", "executable"),
        }
        # Include usage count if available
        if hasattr(tool, "usage_count"):
            tool_info["usage_count"] = tool.usage_count
        # Include dependencies if available
        if hasattr(tool, "depends_on"):
            tool_info["depends_on"] = tool.depends_on
        tools_list.append(tool_info)
    return {"tools": tools_list, "count": len(tools_list)}


@app.get("/composio/connections")
async def list_composio_connections():
    """List Composio connected accounts and their status."""
    try:
        from composio import Composio
        client = Composio()
    except Exception:
        return {"connections": [], "error": "Composio not available"}

    user_id = agent.config.get("composio_entity_id", "default") if hasattr(agent, "config") else "default"

    try:
        resp = client.connected_accounts.list(user_ids=[user_id])
        connections = []
        for account in resp.items:
            connections.append({
                "id": account.id,
                "app": account.toolkit.slug if hasattr(account, "toolkit") else "unknown",
                "status": account.status,
                "created_at": str(getattr(account, "created_at", "")),
            })

        # Also check local DB for pending connections with redirect URLs
        pending_with_urls = []
        if hasattr(agent, "memory") and agent.memory:
            local_conns = agent.memory.store.list_credentials(credential_type="composio_connection")
            for cred in local_conns:
                if cred.metadata and cred.metadata.get("status") == "pending":
                    pending_with_urls.append({
                        "id": cred.metadata.get("connection_id"),
                        "app": cred.service,
                        "status": "pending",
                        "redirect_url": cred.metadata.get("redirect_url"),
                    })

        return {
            "connections": connections,
            "pending": pending_with_urls,
            "user_id": user_id,
        }
    except Exception as e:
        return {"connections": [], "error": str(e)}


@app.get("/tools/{tool_name}")
async def get_tool_detail(tool_name: str):
    """Get detailed info for a single tool including its JSON schema."""
    tool = agent.tools.get(tool_name)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")

    info = {
        "name": tool_name,
        "description": getattr(tool, "description", ""),
        "type": getattr(tool, "type", "executable"),
    }
    if hasattr(tool, "schema"):
        info["schema"] = tool.schema
    if hasattr(tool, "usage_count"):
        info["usage_count"] = tool.usage_count
    if hasattr(tool, "depends_on"):
        info["depends_on"] = tool.depends_on
    if hasattr(tool, "packages"):
        info["packages"] = tool.packages
    if hasattr(tool, "env"):
        info["env"] = tool.env
    return info


# =============================================================================
# Memory / Knowledge Graph Endpoints
# =============================================================================

@app.get("/memory/entities")
async def list_memory_entities(
    type: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 50,
):
    """List entities from the knowledge graph."""
    if not agent.memory:
        return {"entities": [], "error": "Memory system not available"}
    try:
        entities = agent.memory.store.find_entities(query=query, type=type, limit=limit)
        return {
            "entities": [
                {
                    "id": e.id,
                    "name": e.name,
                    "type": e.type,
                    "type_raw": e.type_raw,
                    "description": e.description,
                    "aliases": e.aliases,
                    "is_owner": e.is_owner,
                    "event_count": e.event_count,
                    "first_seen": str(e.first_seen) if e.first_seen else None,
                    "last_seen": str(e.last_seen) if e.last_seen else None,
                }
                for e in entities
            ]
        }
    except Exception as e:
        return {"entities": [], "error": str(e)}


@app.get("/memory/edges")
async def list_memory_edges(entity_id: Optional[str] = None, limit: int = 100):
    """List edges (relationships) from the knowledge graph."""
    if not agent.memory:
        return {"edges": [], "error": "Memory system not available"}
    try:
        if entity_id:
            edges = agent.memory.store.get_edges(entity_id)
        else:
            # Get all current edges
            cur = agent.memory.store.conn.cursor()
            cur.execute(
                "SELECT * FROM edges WHERE is_current = 1 ORDER BY strength DESC LIMIT ?",
                (limit,),
            )
            edges = [agent.memory.store._row_to_edge(row) for row in cur.fetchall()]

        return {
            "edges": [
                {
                    "id": e.id,
                    "source_entity_id": e.source_entity_id,
                    "target_entity_id": e.target_entity_id,
                    "relation": e.relation,
                    "relation_type": e.relation_type,
                    "strength": e.strength,
                    "is_current": e.is_current,
                }
                for e in edges
            ]
        }
    except Exception as e:
        return {"edges": [], "error": str(e)}


@app.get("/memory/graph")
async def get_memory_graph(limit: int = 50):
    """Get entities + edges as nodes/links for graph visualization."""
    if not agent.memory:
        return {"nodes": [], "links": [], "error": "Memory system not available"}
    try:
        entities = agent.memory.store.find_entities(limit=limit)
        entity_ids = {e.id for e in entities}

        # Get all edges between these entities
        cur = agent.memory.store.conn.cursor()
        if entity_ids:
            placeholders = ",".join("?" for _ in entity_ids)
            cur.execute(
                f"""SELECT * FROM edges WHERE is_current = 1
                    AND source_entity_id IN ({placeholders})
                    AND target_entity_id IN ({placeholders})""",
                list(entity_ids) + list(entity_ids),
            )
            edges = [agent.memory.store._row_to_edge(row) for row in cur.fetchall()]
        else:
            edges = []

        nodes = [
            {
                "id": e.id,
                "name": e.name,
                "type": e.type,
                "event_count": e.event_count,
                "description": e.description,
                "is_owner": e.is_owner,
            }
            for e in entities
        ]
        links = [
            {
                "source": e.source_entity_id,
                "target": e.target_entity_id,
                "relation": e.relation,
                "strength": e.strength,
            }
            for e in edges
        ]
        return {"nodes": nodes, "links": links}
    except Exception as e:
        return {"nodes": [], "links": [], "error": str(e)}


@app.get("/memory/stats")
async def get_memory_stats():
    """Get memory system statistics (no LLM calls — just counts)."""
    if not agent.memory:
        raise HTTPException(status_code=503, detail="Memory system not available")
    try:
        cur = agent.memory.store.conn.cursor()

        def _count(table: str) -> int:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            return cur.fetchone()[0]

        stats = {
            "events": _count("events"),
            "entities": _count("entities"),
            "edges": _count("edges"),
            "topics": _count("topics"),
            "summary_nodes": _count("summary_nodes"),
        }

        # Try optional tables
        for table in ("facts", "learnings"):
            try:
                stats[table] = _count(table)
            except Exception:
                stats[table] = 0

        # Extraction status breakdown
        cur.execute(
            "SELECT extraction_status, COUNT(*) FROM events GROUP BY extraction_status"
        )
        stats["extraction_status"] = {row[0]: row[1] for row in cur.fetchall()}

        return stats
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get memory stats: {e}")


# =============================================================================
# Model Configuration Endpoints
# =============================================================================

@app.get("/config/model")
async def get_model_config():
    """Get the current active model and available model options."""
    from llm_config import get_llm_config, get_available_provider

    llm_config = get_llm_config()
    provider = get_available_provider()

    available_models = []
    # Always show the currently active model first
    available_models.append({"id": agent.model, "label": agent.model, "provider": provider})

    # Add known options based on available API keys
    known_models = []
    if os.environ.get("MOONSHOT_API_KEY"):
        known_models.append({"id": "moonshot/kimi-k2.5", "label": "Kimi K2.5 (Moonshot)", "provider": "moonshot"})
    if os.environ.get("ANTHROPIC_API_KEY"):
        known_models.append({"id": "claude-sonnet-4-20250514", "label": "Claude Sonnet 4", "provider": "anthropic"})
        known_models.append({"id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5", "provider": "anthropic"})
        known_models.append({"id": "claude-opus-4-20250514", "label": "Claude Opus 4", "provider": "anthropic"})
    if os.environ.get("OPENAI_API_KEY"):
        known_models.append({"id": "gpt-4o", "label": "GPT-4o", "provider": "openai"})
        known_models.append({"id": "gpt-4o-mini", "label": "GPT-4o Mini", "provider": "openai"})

    # Deduplicate (don't re-add the active model)
    seen = {agent.model}
    for m in known_models:
        if m["id"] not in seen:
            available_models.append(m)
            seen.add(m["id"])

    return {
        "active_model": agent.model,
        "provider": provider,
        "available_models": available_models,
    }


class ModelChangeRequest(BaseModel):
    model: str


@app.post("/config/model")
async def set_model_config(req: ModelChangeRequest):
    """Change the active agent model at runtime and persist to .env."""
    from llm_config import get_llm_config, ModelConfig

    model = req.model.strip()
    if not model:
        raise HTTPException(status_code=400, detail="Model name cannot be empty")

    old_model = agent.model
    agent.model = model

    # Update ALL use cases in the global llm_config so memory, fast, coding etc.
    # all use the new model too (not just the agent loop)
    try:
        llm_config = get_llm_config()
        llm_config.skill_building_model = ModelConfig(model_id=model, max_tokens=16384)
        llm_config.coding_model = ModelConfig(model_id=model, max_tokens=8096)
        llm_config.research_model = ModelConfig(model_id=model, max_tokens=4096)
        llm_config.agent_model = ModelConfig(model_id=model, max_tokens=8096)
        llm_config.memory_model = ModelConfig(model_id=model, max_tokens=4096)
        llm_config.fast_model = ModelConfig(model_id=model, max_tokens=1024)
    except Exception as e:
        logger.error(f"Failed to update llm_config: {e}")

    # Also update the agent's summarizer model
    if hasattr(agent, '_summarizer_model'):
        agent._summarizer_model = model

    # Persist AGENT_MODEL to .env so it survives restarts
    try:
        _persist_env_var("AGENT_MODEL", model)
    except Exception as e:
        logger.error(f"Failed to persist AGENT_MODEL to .env: {e}")

    # Update process env var so any new imports pick it up
    os.environ["AGENT_MODEL"] = model

    # Clear main thread so old model responses don't carry over
    agent.threads["main"] = []

    logger.info(f"All models changed: {old_model} -> {model}")
    return {"status": "ok", "old_model": old_model, "new_model": model}


def _persist_env_var(key: str, value: str):
    """Write or update a key=value in the .env file (atomic write)."""
    env_path = Path(__file__).parent / ".env"
    lines = []
    found = False

    if env_path.exists():
        with open(env_path, "r") as f:
            lines = f.readlines()

    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            new_lines.append(f"{key}={value}\n")
            found = True
        else:
            new_lines.append(line)

    if not found:
        new_lines.append(f"{key}={value}\n")

    # Atomic write: write to temp file, then replace
    temp_path = env_path.with_suffix('.env.tmp')
    with open(temp_path, "w") as f:
        f.writelines(new_lines)
    temp_path.replace(env_path)


# =============================================================================
# Metrics Endpoints
# =============================================================================

@app.get("/metrics/summary")
async def get_metrics_summary(period: str = "day"):
    """Get cost & usage metrics (reads in-memory counters — $0 cost)."""
    try:
        summary = agent.metrics_collector.get_summary(period=period)
        return {
            "period": period,
            "period_start": str(summary.period_start),
            "period_end": str(summary.period_end),
            "llm": {
                "calls": summary.total_llm_calls,
                "tokens": summary.total_tokens,
                "cost_usd": round(summary.total_llm_cost_usd, 6),
                "avg_latency_ms": round(summary.avg_llm_latency_ms, 1),
            },
            "embeddings": {
                "calls": summary.total_embedding_calls,
                "cost_usd": round(summary.total_embedding_cost_usd, 6),
                "cache_hit_rate": round(summary.embedding_cache_hit_rate, 1),
            },
            "tools": {
                "calls": summary.total_tool_calls,
                "success_rate": round(summary.tool_success_rate, 1),
                "avg_latency_ms": round(summary.avg_tool_latency_ms, 1),
            },
            "total_cost_usd": round(summary.total_cost_usd, 6),
            "cost_by_model": {k: round(v, 6) for k, v in summary.cost_by_model.items()},
            "cost_by_source": {k: round(v, 6) for k, v in summary.cost_by_source.items()},
            "calls_by_source": summary.calls_by_source,
            "calls_by_tool": summary.calls_by_tool,
            "errors_by_tool": summary.errors_by_tool,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get metrics: {e}")


# =============================================================================
# Channels Endpoint
# =============================================================================

@app.get("/channels")
async def list_channels():
    """List all configured communication channels with status."""
    channels = []

    # Read channel config
    config = {}
    if hasattr(agent, "config_loader") and agent.config_loader:
        config = agent.config_loader.get("channels", {})
    elif hasattr(agent, "config") and isinstance(agent.config, dict):
        config = agent.config.get("channels", {})

    # Known channel definitions
    channel_defs = {
        "cli": {"name": "CLI", "description": "Terminal command line interface"},
        "email": {"name": "Email", "description": "Email via AgentMail", "env_keys": ["AGENTMAIL_API_KEY"]},
        "sendblue": {"name": "SendBlue", "description": "SMS/iMessage via SendBlue", "env_keys": ["SENDBLUE_API_KEY", "SENDBLUE_API_SECRET"]},
        "telegram": {"name": "Telegram", "description": "Telegram bot messaging", "env_keys": ["TELEGRAM_BOT_TOKEN"]},
        "discord": {"name": "Discord", "description": "Discord bot messaging", "env_keys": ["DISCORD_BOT_TOKEN"]},
        "voice": {"name": "Voice", "description": "Voice input/output via Whisper"},
        "meeting": {"name": "Meeting Bot", "description": "Meeting transcription via Recall.ai", "env_keys": ["RECALL_API_KEY"]},
    }

    for key, defn in channel_defs.items():
        ch_config = config.get(key, {})
        config_enabled = ch_config.get("enabled", False) if isinstance(ch_config, dict) else False

        # Check if required env vars are set
        env_keys = defn.get("env_keys", [])
        keys_set = all(bool(os.environ.get(k)) for k in env_keys) if env_keys else True

        # Check if sender is registered
        has_sender = key in agent.senders if hasattr(agent, "senders") else False

        # Channel is active if explicitly enabled in config OR if all required keys are set
        enabled = config_enabled or (keys_set and len(env_keys) > 0) or has_sender

        channels.append({
            "id": key,
            "name": defn["name"],
            "description": defn["description"],
            "enabled": enabled,
            "keys_configured": keys_set,
            "has_sender": has_sender,
            "required_env_keys": env_keys,
        })

    return {"channels": channels}


# =============================================================================
# Secrets & Credentials Endpoints
# =============================================================================

@app.get("/secrets")
async def list_secrets_endpoint():
    """List all known API keys/secrets (masked values only)."""
    try:
        from tools.secrets import list_secrets as _list_secrets
        return _list_secrets()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list secrets: {e}")


class StoreSecretRequest(BaseModel):
    name: str
    value: str


@app.post("/secrets")
async def store_secret_endpoint(req: StoreSecretRequest):
    """Store an API key/secret securely."""
    try:
        from tools.secrets import store_secret as _store_secret
        return _store_secret(req.name, req.value, agent=agent)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store secret: {e}")


@app.delete("/secrets/{name}")
async def delete_secret_endpoint(name: str):
    """Delete a stored secret."""
    try:
        from tools.secrets import delete_secret as _delete_secret
        return _delete_secret(name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete secret: {e}")


@app.get("/secrets/check/{name}")
async def check_secret_endpoint(name: str):
    """Check if a specific secret/API key exists."""
    try:
        from tools.secrets import _check_secret
        return _check_secret(name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check secret: {e}")


@app.get("/credentials")
async def list_credentials_endpoint():
    """List all stored credentials (accounts, payment methods) — no sensitive data."""
    try:
        from tools.credentials import list_credentials as _list_credentials
        return _list_credentials(agent=agent)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list credentials: {e}")


# =============================================================================
# File Storage Endpoints
# =============================================================================

@app.get("/files")
async def list_files():
    """List files in attached_assets directory."""
    import pathlib
    assets_dir = pathlib.Path(__file__).parent / "attached_assets"
    if not assets_dir.exists():
        return {"files": []}
    files = []
    for f in sorted(assets_dir.iterdir()):
        if f.is_file():
            stat = f.stat()
            files.append({
                "name": f.name,
                "size_bytes": stat.st_size,
                "modified": str(datetime.fromtimestamp(stat.st_mtime)),
            })
    return {"files": files}


@app.post("/files/upload")
async def upload_file(request: Request):
    """Upload a file to attached_assets."""
    import pathlib
    from fastapi.responses import JSONResponse

    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type:
        raise HTTPException(status_code=400, detail="Expected multipart/form-data")

    form = await request.form()
    uploaded = form.get("file")
    if not uploaded:
        raise HTTPException(status_code=400, detail="No file provided")

    assets_dir = pathlib.Path(__file__).parent / "attached_assets"
    assets_dir.mkdir(exist_ok=True)

    # Sanitize filename - strip path components
    filename = PurePosixPath(uploaded.filename).name
    filename = filename.replace("..", "_")  # Extra safety
    if not filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    contents = await uploaded.read()
    # Size limit: 50MB
    if len(contents) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")

    dest = assets_dir / filename
    dest.write_bytes(contents)

    return JSONResponse({"filename": filename, "size_bytes": len(contents), "path": str(dest)})


# =============================================================================
# SendBlue Webhook
# =============================================================================

# Track processed message IDs to prevent duplicates (OrderedDict for FIFO eviction)
_sendblue_processed_ids: OrderedDict = OrderedDict()


def _normalize_phone(phone: str) -> str:
    """Normalize phone number for comparison."""
    if not phone:
        return ""
    cleaned = phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "").replace(".", "")
    if not cleaned.startswith("+"):
        if cleaned.startswith("1") and len(cleaned) == 11:
            cleaned = "+" + cleaned
        elif len(cleaned) == 10:
            cleaned = "+1" + cleaned
    return cleaned.lower()


@app.post("/webhooks/sendblue")
async def sendblue_webhook(
    payload: SendBlueWebhookPayload,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """
    Receive inbound SMS/iMessage from SendBlue.

    Configure this URL in your SendBlue dashboard:
    https://your-domain.com/webhooks/sendblue

    SendBlue will POST to this endpoint when messages are received.
    """
    global _sendblue_processed_ids

    # Log the incoming webhook
    console.activity("sendblue", f"inbound from {payload.from_number}")

    # Get message ID for deduplication
    msg_id = payload.message_handle or f"{payload.from_number}:{payload.date_sent}"

    # Skip if already processed (webhooks can be sent multiple times)
    if msg_id in _sendblue_processed_ids:
        logger.debug(f"SendBlue webhook: skipping duplicate message {msg_id}")
        return {"status": "ok", "message": "duplicate"}

    # Skip outbound messages (this webhook is for inbound)
    if payload.is_outbound:
        logger.debug(f"SendBlue webhook: skipping outbound message {msg_id}")
        return {"status": "ok", "message": "outbound_ignored"}

    # Skip empty messages
    if not payload.content and not payload.media_url:
        logger.debug(f"SendBlue webhook: skipping empty message {msg_id}")
        return {"status": "ok", "message": "empty_ignored"}

    # Mark as processed
    _sendblue_processed_ids[msg_id] = None

    # FIFO eviction: remove oldest entries
    if len(_sendblue_processed_ids) > 1000:
        while len(_sendblue_processed_ids) > 500:
            _sendblue_processed_ids.popitem(last=False)

    # Get owner phone for comparison
    owner_phone = os.environ.get("OWNER_PHONE", "")
    owner_phone_normalized = _normalize_phone(owner_phone)
    from_number_normalized = _normalize_phone(payload.from_number or "")

    # Determine if owner
    is_owner = bool(
        owner_phone_normalized and
        from_number_normalized == owner_phone_normalized
    )

    # Build thread ID
    if is_owner:
        thread_id = "sendblue:owner"
    else:
        thread_id = f"sendblue:{from_number_normalized}"

    # Build context
    context = {
        "channel": "sendblue",
        "is_owner": is_owner,
        "sender": payload.from_number,
        "message_id": msg_id,
    }

    # Format input with message context
    sender_type = "Owner" if is_owner else "External"
    message_input = f"[Text from {sender_type}: {payload.from_number}]\n\n{payload.content or ''}"

    if payload.media_url:
        message_input += f"\n\n[Media attached: {payload.media_url}]"

    logger.debug(f"Processing SendBlue message from {payload.from_number} (owner={is_owner})")

    # Process in background to return 200 quickly (SendBlue requires fast response)
    async def process_and_reply():
        try:
            response_text = await agent.run_async(
                message_input,
                thread_id=thread_id,
                context=context
            )

            # Auto-reply for owner messages
            if is_owner and response_text:
                if "sendblue" in agent.senders:
                    await agent.senders["sendblue"].send(
                        to=payload.from_number,
                        content=response_text
                    )
                    console.activity("sendblue", f"replied to {payload.from_number}")
                else:
                    logger.warning("SendBlue sender not registered, cannot auto-reply")

        except Exception as e:
            logger.error(f"Error processing SendBlue message: {e}")

    background_tasks.add_task(process_and_reply)

    return {"status": "ok", "message": "processing"}


# =============================================================================
# Recall.ai Webhooks
# =============================================================================

# Track bot IDs that have already been processed to prevent duplicate
# post-meeting processing (multiple status webhooks fire for the same bot)
_recall_processed_bots: OrderedDict = OrderedDict()

@app.websocket("/webhooks/recall/realtime")
async def recall_realtime_websocket(websocket: WebSocket):
    """
    Receive real-time transcript data from Recall.ai via WebSocket.

    Recall.ai connects to this endpoint and streams transcript chunks
    as JSON messages during the meeting.
    """
    await websocket.accept()
    console.activity("recall", "realtime WebSocket connected")

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except Exception as e:
                logger.error(f"Failed to parse Recall realtime WS message: {e}")
                continue

            event_type = payload.get("event", "")
            data = payload.get("data", {})

            if event_type in ("transcript.data", "transcript.partial_data"):
                transcript_data = data.get("data", {})
                bot_info = data.get("bot", {})
                bot_id = bot_info.get("id", "")

                participant = transcript_data.get("participant", {})
                words = transcript_data.get("words", [])
                speaker = participant.get("name", "unknown")
                text = " ".join(w.get("text", "") for w in words)

                if bot_id and text:
                    logger.debug(f"Recall realtime [{event_type}] bot={bot_id}: {speaker}: {text[:100]}")
                    try:
                        from tools.meeting import get_meeting_processor
                        processor = get_meeting_processor()
                        segment = {
                            "speaker": speaker,
                            "speaker_id": participant.get("id"),
                            "words": words,
                            "is_final": event_type == "transcript.data",
                        }
                        processor.add_transcript_segment(bot_id, segment)
                    except Exception as e:
                        logger.error(f"Error processing realtime transcript: {e}")
            else:
                logger.debug(f"Recall realtime WS event: {event_type}")

    except WebSocketDisconnect:
        console.activity("recall", "realtime WebSocket disconnected")
    except Exception as e:
        logger.error(f"Recall realtime WebSocket error: {e}")


@app.post("/webhooks/recall/realtime")
async def recall_realtime_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
):
    """
    Fallback POST handler for real-time transcript data from Recall.ai.
    Kept for backward compatibility if webhook type is used.
    """
    payload = getattr(request.state, 'parsed_payload', None)
    if payload is None:
        try:
            payload = await request.json()
        except Exception as e:
            logger.error(f"Failed to parse Recall realtime webhook: {e}")
            return {"status": "error", "message": "Invalid JSON"}

    data = payload.get("data", {})
    bot_id = data.get("bot", {}).get("id") or payload.get("bot_id")
    transcript = data.get("data", {}) or payload.get("transcript", {})

    if not bot_id or not transcript:
        return {"status": "ok", "message": "no_data"}

    logger.debug(f"Recall realtime transcript for bot {bot_id}: {transcript.get('speaker', 'unknown')}")

    async def process_realtime():
        try:
            from tools.meeting import get_meeting_processor
            processor = get_meeting_processor()
            processor.add_transcript_segment(bot_id, transcript)
        except Exception as e:
            logger.error(f"Error processing realtime transcript: {e}")

    background_tasks.add_task(process_realtime)

    return {"status": "ok"}


@app.post("/webhooks/recall/status")
async def recall_status_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
):
    """
    Receive bot status change events from Recall.ai.

    Status flow: ready → joining_call → in_waiting_room → in_call_recording → call_ended → done

    Configure this URL in your Recall.ai dashboard webhook settings.
    """
    payload = getattr(request.state, 'parsed_payload', None)
    if payload is None:
        try:
            payload = await request.json()
        except Exception as e:
            logger.error(f"Failed to parse Recall status webhook: {e}")
            return {"status": "error", "message": "Invalid JSON"}

    event_type = payload.get("event")
    data = payload.get("data", {})

    # Recall.ai nests bot ID under data.bot.id (not data.bot_id)
    bot_id = data.get("bot", {}).get("id") or data.get("bot_id")
    # Recall.ai nests status code under data.data.code (not data.status.code)
    status = data.get("data", {}).get("code") or data.get("status", {}).get("code")
    # Fall back to extracting status from event type (e.g. "bot.call_ended" → "call_ended")
    if not status and event_type and event_type.startswith("bot."):
        status = event_type.split(".", 1)[1]

    bot_short = (bot_id[:8] + "…") if bot_id else "unknown"
    logger.debug(f"Recall status webhook payload: {payload}")
    console.activity("recall", f"bot {bot_short} → {status or 'unknown'}")

    # Handle meeting end - trigger post-meeting processing.
    # Only process on "done" or "analysis_done" (not "call_ended" which fires
    # before the transcript is ready and causes 400 errors from Recall.ai).
    if status in ("done", "analysis_done"):
        global _recall_processed_bots

        # Deduplicate: skip if this bot has already been processed
        # (both "done" and "analysis_done" can fire for the same bot)
        if bot_id and bot_id in _recall_processed_bots:
            logger.debug(f"Recall: skipping duplicate processing for bot {bot_id}")
            return {"status": "ok", "message": "already_processed"}

        if bot_id:
            _recall_processed_bots[bot_id] = None
            # FIFO eviction: remove oldest entries
            if len(_recall_processed_bots) > 1000:
                while len(_recall_processed_bots) > 500:
                    _recall_processed_bots.popitem(last=False)

        async def process_meeting_end():
            try:
                from tools.meeting import get_meeting_processor, RecallClient

                processor = get_meeting_processor()
                client = RecallClient()

                # Check bot details first to verify it actually recorded
                bot_data = await client.get_bot(bot_id)
                if "error" in bot_data:
                    logger.error(f"Failed to fetch bot details for {bot_id}: {bot_data}")
                    return

                # Check if the bot ever reached recording status.
                # If it was stuck in waiting room or rejected, there's no transcript.
                status_changes = bot_data.get("status_changes", [])
                ever_recorded = any(
                    sc.get("code") == "in_call_recording" or sc.get("sub_code") == "in_call_recording"
                    for sc in status_changes
                )
                if not ever_recorded:
                    logger.warning(
                        f"Bot {bot_id} never reached recording status, skipping transcript fetch. "
                        f"Status history: {[sc.get('code') for sc in status_changes]}"
                    )
                    return

                # Fetch transcript with retry — the transcript download URL may
                # not be available in bot_data immediately when 'done' fires.
                # Re-fetch bot data on retry to get fresh media_shortcuts URLs.
                transcript_data = None
                max_retries = 3
                for attempt in range(max_retries):
                    if attempt > 0:
                        delay = 5 * (2 ** (attempt - 1))  # 5s, 10s
                        logger.info(f"Retrying transcript fetch for bot {bot_id} in {delay}s (attempt {attempt + 1}/{max_retries})")
                        await asyncio.sleep(delay)
                        # Re-fetch bot data to get fresh media_shortcuts URLs
                        bot_data = await client.get_bot(bot_id)

                    transcript_data = await client.get_bot_transcript(bot_id, bot_data=bot_data)
                    if "error" not in transcript_data:
                        break  # Success

                    status_code = transcript_data.get("status_code")
                    if status_code == 400 and attempt < max_retries - 1:
                        # Transcript not ready yet — retry with fresh bot data
                        continue
                    elif status_code == 400:
                        # Final attempt still no transcript — likely a short meeting
                        # with insufficient audio for transcription.
                        logger.warning(
                            f"Transcript unavailable for bot {bot_id} after {max_retries} attempts. "
                            f"This is expected for very short meetings. Detail: {transcript_data.get('detail', '')}"
                        )
                        return
                    else:
                        # Non-400 error — don't retry
                        logger.error(f"Failed to fetch transcript for bot {bot_id}: {transcript_data}")
                        return

                meeting_metadata = {
                    "title": bot_data.get("meeting_metadata", {}).get("title", "Meeting"),
                    "platform": bot_data.get("meeting_url", "").split("/")[2] if bot_data.get("meeting_url") else None,
                    "duration_minutes": 0,  # Calculate from timestamps if available
                }

                # Process the completed meeting
                summary = await processor.process_completed_meeting(
                    bot_id=bot_id,
                    transcript_data=transcript_data,
                    meeting_metadata=meeting_metadata,
                )

                # Notify owner
                owner_phone = os.environ.get("OWNER_PHONE", "")
                if owner_phone and "sendblue" in agent.senders:
                    notification = f"Meeting ended: {meeting_metadata.get('title', 'Meeting')}\n\n"
                    notification += f"Summary: {summary.summary[:300]}..."
                    if summary.action_items:
                        notification += f"\n\nAction items: {len(summary.action_items)}"

                    try:
                        await agent.senders["sendblue"].send(
                            to=owner_phone,
                            content=notification,
                        )
                    except Exception as e:
                        logger.error(f"Failed to send meeting notification: {e}")

                console.activity("recall", f"meeting processed: {meeting_metadata.get('title', 'Meeting')}")

            except Exception as e:
                logger.error(f"Error processing meeting end for bot {bot_id}: {e}")

        background_tasks.add_task(process_meeting_end)

    return {"status": "ok"}


@app.post("/webhooks/recall")
async def recall_general_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
):
    """
    General Recall.ai webhook endpoint.

    Handles multiple event types and routes to appropriate handlers.
    Configure this URL in your Recall.ai dashboard as the main webhook.
    """
    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Failed to parse Recall webhook: {e}")
        return {"status": "error", "message": "Invalid JSON"}

    event_type = payload.get("event", "")
    console.activity("recall", f"webhook: {event_type}")

    # Store parsed payload on request state so sub-handlers don't re-read body
    request.state.parsed_payload = payload

    # Route to appropriate handler — Recall.ai sends specific events like
    # "bot.joining_call", "bot.call_ended", etc. (not a generic "bot.status_change")
    if event_type.startswith("bot."):
        return await recall_status_webhook(request, background_tasks)
    elif event_type in ("transcript.data", "transcript.partial_data"):
        # Reconstruct request-like object for realtime handler
        return await recall_realtime_webhook(request, background_tasks)
    elif event_type == "transcript.done":
        # Transcript done is similar to bot status done
        data = payload.get("data", {})
        bot_id = data.get("bot", {}).get("id") or data.get("bot_id")
        bot_short = (bot_id[:8] + "…") if bot_id else "unknown"
        console.activity("recall", f"transcript done for bot {bot_short}")
        # The status webhook will handle the actual processing when bot status changes to done

    return {"status": "ok", "event": event_type}


# =============================================================================
# Run
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    _host = os.environ.get("BABYAGI_HOST", "127.0.0.1")
    _port = int(os.environ.get("BABYAGI_PORT", "5000"))
    uvicorn.run(app, host=_host, port=_port)
