"use client";

import type { ToolEvent } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

interface InlineToolEventsProps {
  events: ToolEvent[];
}

export function InlineToolEvents({ events }: InlineToolEventsProps) {
  if (events.length === 0) return null;

  // Build a list of unique tools with their final status
  const toolMap = new Map<string, ToolEvent>();
  for (const e of events) {
    toolMap.set(e.name, e);
  }

  return (
    <div className="flex flex-wrap gap-1.5 my-1.5">
      {Array.from(toolMap.entries()).map(([name, event]) => (
        <Badge
          key={name}
          variant="outline"
          className="flex items-center gap-1.5 text-[11px] font-normal py-0.5 px-2 bg-muted/50 border-border/50"
        >
          {event.type === "tool_start" ? (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse shrink-0" />
          ) : (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          )}
          <span className="text-muted-foreground">{name}</span>
          {event.type === "tool_end" && event.duration_ms != null && (
            <span className="text-muted-foreground/60 ml-0.5">
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
