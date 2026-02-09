"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { ScheduledTask, TaskRun } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function statusColor(status: string | null): string {
  switch (status) {
    case "ok":
      return "bg-green-500";
    case "error":
      return "bg-red-500";
    case "running":
      return "bg-yellow-500 animate-pulse";
    default:
      return "bg-muted-foreground";
  }
}

export function TasksContainer() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, TaskRun[]>>({});
  const [triggering, setTriggering] = useState<Set<string>>(new Set());

  const fetchTasks = useCallback(async () => {
    try {
      const data = await apiFetch<{ tasks: ScheduledTask[] }>(
        "/scheduler/tasks?include_disabled=true"
      );
      setTasks(data.tasks);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const id = setInterval(fetchTasks, 15000);
    return () => clearInterval(id);
  }, [fetchTasks]);

  async function loadHistory(taskId: string) {
    try {
      const data = await apiFetch<{ runs: TaskRun[] }>(
        `/scheduler/tasks/${taskId}/history?limit=10`
      );
      setHistory((prev) => ({ ...prev, [taskId]: data.runs }));
    } catch {
      // ignore
    }
  }

  function toggleExpand(taskId: string) {
    if (expandedTask === taskId) {
      setExpandedTask(null);
    } else {
      setExpandedTask(taskId);
      if (!history[taskId]) {
        loadHistory(taskId);
      }
    }
  }

  async function triggerTask(taskId: string) {
    setTriggering((prev) => new Set(prev).add(taskId));
    try {
      await apiFetch(`/scheduler/tasks/${taskId}/run`, { method: "POST" });
      setTimeout(fetchTasks, 2000);
    } catch {
      // ignore
    } finally {
      setTriggering((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function toggleEnabled(taskId: string, enabled: boolean) {
    try {
      await apiFetch(`/scheduler/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      fetchTasks();
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading scheduled tasks...
      </div>
    );
  }

  if (error) {
    const isConnectionError =
      error.includes("fetch") || error.includes("NetworkError") || error.includes("Failed") || error.includes("404");
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <p className="text-destructive text-sm">
          {isConnectionError
            ? "Cannot reach the backend server."
            : `Failed to load tasks: ${error}`}
        </p>
        <p className="text-xs text-muted-foreground max-w-md">
          {isConnectionError
            ? "Make sure the BabyAGI backend is running and has been restarted to pick up the latest API endpoints. Run: python main.py serve"
            : "The server may need to be restarted to load the new scheduler endpoints."}
        </p>
        <Button variant="outline" size="sm" onClick={fetchTasks}>
          Retry
        </Button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <p className="text-lg font-medium">No scheduled tasks</p>
        <p className="text-sm">
          Ask the agent to create a scheduled workflow in the chat.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-4 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-semibold">Scheduled Tasks</h1>
          <Badge variant="secondary">{tasks.length} tasks</Badge>
        </div>

        {tasks.map((task) => (
          <Card
            key={task.id}
            className="p-4 space-y-3 transition-colors hover:bg-muted/30"
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusColor(
                      task.last_status
                    )}`}
                  />
                  <h3 className="font-medium text-sm truncate">{task.name}</h3>
                  {!task.enabled && (
                    <Badge variant="outline" className="text-xs opacity-60">
                      Disabled
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {task.goal}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => triggerTask(task.id)}
                  disabled={triggering.has(task.id)}
                >
                  {triggering.has(task.id) ? "Running..." : "Run Now"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => toggleEnabled(task.id, !task.enabled)}
                >
                  {task.enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>

            {/* Info row */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground">Schedule:</strong>{" "}
                {task.schedule}
              </span>
              {task.schedule_raw.tz && (
                <span>
                  <strong className="text-foreground">TZ:</strong>{" "}
                  {task.schedule_raw.tz}
                </span>
              )}
              <span>
                <strong className="text-foreground">Next run:</strong>{" "}
                {formatDate(task.next_run_at)}
              </span>
              <span>
                <strong className="text-foreground">Last run:</strong>{" "}
                {formatDate(task.last_run_at)}
              </span>
              <span>
                <strong className="text-foreground">Runs:</strong>{" "}
                {task.run_count}
              </span>
            </div>

            {/* Error display */}
            {task.last_error && (
              <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
                Last error: {task.last_error}
              </p>
            )}

            {/* Expand/collapse history */}
            <button
              onClick={() => toggleExpand(task.id)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expandedTask === task.id ? "▾ Hide history" : "▸ Show history"}
            </button>

            {/* History panel */}
            {expandedTask === task.id && (
              <div className="border-t pt-3 space-y-2">
                {!history[task.id] ? (
                  <p className="text-xs text-muted-foreground">Loading...</p>
                ) : history[task.id].length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No execution history yet.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {history[task.id].map((run, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 text-xs py-1 px-2 rounded bg-muted/50"
                      >
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(
                            run.status
                          )}`}
                        />
                        <span className="text-muted-foreground w-32 shrink-0">
                          {formatDate(run.started_at)}
                        </span>
                        <Badge
                          variant={
                            run.status === "ok" ? "secondary" : "destructive"
                          }
                          className="text-[10px] h-4"
                        >
                          {run.status}
                        </Badge>
                        <span className="text-muted-foreground">
                          {formatDuration(run.duration_ms)}
                        </span>
                        {run.error && (
                          <span className="text-destructive truncate flex-1">
                            {run.error}
                          </span>
                        )}
                        {run.result && !run.error && (
                          <span className="text-muted-foreground truncate flex-1">
                            {run.result}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}
