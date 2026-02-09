"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { ToolInfo, ComposioConnection } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

function connStatusColor(status: string): string {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "bg-green-500";
    case "EXPIRED":
      return "bg-red-500";
    case "INITIATED":
    case "INITIALIZING":
    case "PENDING":
      return "bg-yellow-500 animate-pulse";
    default:
      return "bg-muted-foreground";
  }
}

function connStatusBadge(status: string): "secondary" | "destructive" | "outline" {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "secondary";
    case "EXPIRED":
      return "destructive";
    default:
      return "outline";
  }
}

const SERVICE_PREFIXES = [
  "gmail",
  "googlecalendar",
  "googledocs",
  "googlesheets",
  "linkedin",
];

const SERVICE_ICONS: Record<string, string> = {
  gmail: "📧",
  googlecalendar: "📅",
  googledocs: "📄",
  googlesheets: "📊",
  linkedin: "💼",
};

const SERVICE_LABELS: Record<string, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googledocs: "Google Docs",
  googlesheets: "Google Sheets",
  linkedin: "LinkedIn",
};

interface ToolGroup {
  id: string;
  label: string;
  icon: string;
  description: string;
  actionCount: number;
  tools: ToolInfo[];
}

function groupTools(tools: ToolInfo[]): { services: ToolGroup[]; core: ToolInfo[] } {
  const serviceMap = new Map<string, ToolInfo[]>();
  const core: ToolInfo[] = [];

  for (const tool of tools) {
    const prefix = SERVICE_PREFIXES.find((p) => tool.name.startsWith(p + "_"));
    if (prefix) {
      const list = serviceMap.get(prefix) || [];
      list.push(tool);
      serviceMap.set(prefix, list);
    } else {
      core.push(tool);
    }
  }

  const services: ToolGroup[] = [];
  for (const [prefix, groupTools] of serviceMap) {
    services.push({
      id: prefix,
      label: SERVICE_LABELS[prefix] || prefix,
      icon: SERVICE_ICONS[prefix] || "🔗",
      description: `${groupTools.length} actions available`,
      actionCount: groupTools.length,
      tools: groupTools,
    });
  }

  services.sort((a, b) => a.label.localeCompare(b.label));
  return { services, core };
}

export function ToolsContainer() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [pendingConns, setPendingConns] = useState<ComposioConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTools = useCallback(async () => {
    try {
      const data = await apiFetch<{ tools: ToolInfo[]; count: number }>(
        "/tools"
      );
      setTools(data.tools);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchConnections = useCallback(async () => {
    try {
      const data = await apiFetch<{
        connections: ComposioConnection[];
        pending: ComposioConnection[];
      }>("/composio/connections");
      setConnections(data.connections || []);
      setPendingConns(data.pending || []);
    } catch {
      // Composio may not be configured — not an error
    }
  }, []);

  useEffect(() => {
    fetchTools();
    fetchConnections();
  }, [fetchTools, fetchConnections]);

  const allConns = [
    ...connections,
    ...pendingConns.filter(
      (p) => !connections.some((c) => c.id === p.id)
    ),
  ];

  const { services, core } = groupTools(tools);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading tools...
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
            : `Failed to load tools: ${error}`}
        </p>
        <p className="text-xs text-muted-foreground max-w-md">
          {isConnectionError
            ? "Make sure the BabyAGI backend is running and has been restarted to pick up the latest API endpoints. Run: python main.py serve"
            : "The server may need to be restarted to load the new tools endpoint."}
        </p>
        <Button variant="outline" size="sm" onClick={fetchTools}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Tools & Integrations</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {services.length} connected services, {core.length} core tools
            </p>
          </div>
          <Badge variant="secondary">{tools.length} total</Badge>
        </div>

        {/* Connected Services */}
        {(allConns.length > 0 || services.length > 0) && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Connected Services
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {services.map((svc) => {
                const conn = allConns.find(
                  (c) => c.app.toLowerCase() === svc.id.replace("google", "google")
                    || svc.id.startsWith(c.app.toLowerCase())
                );
                return (
                  <Card
                    key={svc.id}
                    className="p-4 space-y-2 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">{svc.icon}</span>
                        <h3 className="font-medium text-sm">{svc.label}</h3>
                      </div>
                      {conn ? (
                        <Badge
                          variant={connStatusBadge(conn.status)}
                          className="text-[10px]"
                        >
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${connStatusColor(
                              conn.status
                            )}`}
                          />
                          {conn.status}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Available
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {svc.actionCount} actions available
                    </p>
                    {conn?.created_at && (
                      <p className="text-[10px] text-muted-foreground">
                        Connected:{" "}
                        {new Date(conn.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    )}
                    {conn?.redirect_url &&
                      conn.status.toUpperCase() !== "ACTIVE" && (
                        <a
                          href={conn.redirect_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
                        >
                          Authorize {svc.label} &rarr;
                        </a>
                      )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Core Agent Tools */}
        {core.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Core Agent Tools
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {core.map((tool) => (
                <Card
                  key={tool.name}
                  className="p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">⚡</span>
                      <h3 className="font-medium text-sm">{tool.name}</h3>
                    </div>
                    {tool.usage_count != null && tool.usage_count > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {tool.usage_count}x used
                      </span>
                    )}
                  </div>
                  {tool.description && (
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                      {tool.description}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
