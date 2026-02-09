"use client";

import type { ToolEvent } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

interface ToolEventIndicatorProps {
  events: ToolEvent[];
}

export function ToolEventIndicator({ events }: ToolEventIndicatorProps) {
  if (events.length === 0) return null;

  // Group events: find the latest event per tool name
  const latest = new Map<string, ToolEvent>();
  for (const e of events) {
    latest.set(e.name, e);
  }

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2">
      {Array.from(latest.entries()).map(([name, event]) => (
        <Badge
          key={name}
          variant={event.type === "tool_start" ? "secondary" : "outline"}
          className="flex items-center gap-1.5 text-xs"
        >
          {event.type === "tool_start" ? (
            <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          ) : (
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
          )}
          {name}
          {event.type === "tool_end" && event.duration_ms != null && (
            <span className="text-muted-foreground ml-1">
              {event.duration_ms < 1000
                ? `${event.duration_ms}ms`
                : `${(event.duration_ms / 1000).toFixed(1)}s`}
            </span>
          )}
        </Badge>
      ))}
    </div>
  );
}
