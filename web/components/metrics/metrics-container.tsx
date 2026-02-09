"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface MetricsSummary {
  period: string;
  period_start: string;
  period_end: string;
  llm: {
    calls: number;
    tokens: number;
    cost_usd: number;
    avg_latency_ms: number;
  };
  embeddings: {
    calls: number;
    cost_usd: number;
    cache_hit_rate: number;
  };
  tools: {
    calls: number;
    success_rate: number;
    avg_latency_ms: number;
  };
  total_cost_usd: number;
  cost_by_model: Record<string, number>;
  cost_by_source: Record<string, number>;
  calls_by_source: Record<string, number>;
  calls_by_tool: Record<string, number>;
  errors_by_tool: Record<string, number>;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatLatency(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function BarRow({
  label,
  value,
  maxValue,
  suffix,
}: {
  label: string;
  value: number;
  maxValue: number;
  suffix?: string;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-32 truncate text-muted-foreground">{label}</span>
      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary/60 rounded-full transition-all"
          style={{ width: `${Math.max(1, pct)}%` }}
        />
      </div>
      <span className="w-20 text-right font-mono">
        {suffix ? `${value} ${suffix}` : value}
      </span>
    </div>
  );
}

export function MetricsContainer() {
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [period, setPeriod] = useState("day");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<MetricsSummary>(
        `/metrics/summary?period=${period}`
      );
      setData(res);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    async function loadModel() {
      try {
        const res = await apiFetch<{ active_model: string }>("/config/model");
        setActiveModel(res.active_model);
      } catch {
        // Backend not reachable
      }
    }
    loadModel();
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading metrics...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <p className="text-destructive text-sm">
          Failed to load metrics: {error}
        </p>
        <p className="text-xs text-muted-foreground max-w-md">
          Make sure the backend is running. Metrics read in-memory counters — no
          LLM cost.
        </p>
        <Button variant="outline" size="sm" onClick={fetchMetrics}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const modelEntries = Object.entries(data.cost_by_model).sort(
    (a, b) => b[1] - a[1]
  );
  const sourceEntries = Object.entries(data.cost_by_source).sort(
    (a, b) => b[1] - a[1]
  );
  const toolEntries = Object.entries(data.calls_by_tool).sort(
    (a, b) => b[1] - a[1]
  );
  const maxToolCalls = toolEntries.length > 0 ? toolEntries[0][1] : 1;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">Metrics</h1>
            {activeModel && (
              <Badge variant="outline" className="text-xs font-normal">
                Model: {activeModel}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {["hour", "day", "week", "month", "all"].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  period === p
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchMetrics}
              className="ml-2"
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Top-level stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Total Cost"
            value={formatCost(data.total_cost_usd)}
            sub={`${period} period`}
          />
          <StatCard
            label="LLM Calls"
            value={String(data.llm.calls)}
            sub={`${data.llm.tokens.toLocaleString()} tokens`}
          />
          <StatCard
            label="Tool Calls"
            value={String(data.tools.calls)}
            sub={`${data.tools.success_rate}% success`}
          />
          <StatCard
            label="Avg Latency"
            value={formatLatency(data.llm.avg_latency_ms)}
            sub="LLM response"
          />
        </div>

        {/* Cost breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* By Model */}
          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-semibold">Cost by Model</h2>
            {modelEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet</p>
            ) : (
              <div className="space-y-2">
                {modelEntries.map(([model, cost]) => (
                  <div
                    key={model}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="truncate text-muted-foreground max-w-[60%]">
                      {model}
                    </span>
                    <span className="font-mono">{formatCost(cost)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* By Source */}
          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-semibold">Cost by Source</h2>
            {sourceEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet</p>
            ) : (
              <div className="space-y-2">
                {sourceEntries.map(([source, cost]) => (
                  <div
                    key={source}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="capitalize text-muted-foreground">
                      {source}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{formatCost(cost)}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {data.calls_by_source[source] || 0} calls
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Tool usage */}
        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-semibold">Tool Usage</h2>
          {toolEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tool calls yet</p>
          ) : (
            <div className="space-y-2">
              {toolEntries.slice(0, 15).map(([tool, calls]) => (
                <BarRow
                  key={tool}
                  label={tool}
                  value={calls}
                  maxValue={maxToolCalls}
                  suffix={
                    data.errors_by_tool[tool]
                      ? `(${data.errors_by_tool[tool]} errors)`
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </Card>

        {/* Embeddings */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            label="Embedding Calls"
            value={String(data.embeddings.calls)}
            sub={formatCost(data.embeddings.cost_usd)}
          />
          <StatCard
            label="Cache Hit Rate"
            value={`${data.embeddings.cache_hit_rate}%`}
          />
          <StatCard
            label="Tool Avg Latency"
            value={formatLatency(data.tools.avg_latency_ms)}
          />
        </div>
      </div>
    </div>
  );
}
