"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Channel {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  keys_configured: boolean;
  has_sender: boolean;
  required_env_keys: string[];
}

const CHANNEL_ICONS: Record<string, string> = {
  cli: "💻",
  email: "📧",
  sendblue: "💬",
  telegram: "✈️",
  discord: "🎮",
  voice: "🎙️",
  meeting: "📹",
};

function statusLabel(ch: Channel): { text: string; color: string } {
  if (!ch.enabled) return { text: "Disabled", color: "bg-muted-foreground" };
  if (ch.required_env_keys.length > 0 && !ch.keys_configured)
    return { text: "Missing Keys", color: "bg-yellow-500" };
  if (ch.has_sender) return { text: "Active", color: "bg-green-500" };
  if (ch.enabled && ch.keys_configured)
    return { text: "Configured", color: "bg-blue-500" };
  return { text: "Enabled", color: "bg-blue-500" };
}

export function ChannelsContainer() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    try {
      const data = await apiFetch<{ channels: Channel[] }>("/channels");
      setChannels(data.channels || []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading channels...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <p className="text-destructive text-sm">
          Failed to load channels: {error}
        </p>
        <p className="text-xs text-muted-foreground max-w-md">
          Make sure the backend is running and has been restarted to pick up the
          /channels endpoint.
        </p>
        <Button variant="outline" size="sm" onClick={fetchChannels}>
          Retry
        </Button>
      </div>
    );
  }

  const active = channels.filter((c) => c.enabled && c.keys_configured);
  const inactive = channels.filter((c) => !c.enabled || !c.keys_configured);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Channels</h1>
          <Badge variant="secondary">
            {active.length} active / {channels.length} total
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">
          Communication channels allow BabyAGI to receive and send messages
          through different platforms. Configure API keys in your{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">.env</code>{" "}
          file and enable channels in{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            config.yaml
          </code>
          .
        </p>

        {/* Active channels */}
        {active.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Active Channels
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {active.map((ch) => {
                const status = statusLabel(ch);
                return (
                  <Card
                    key={ch.id}
                    className="p-4 space-y-2 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {CHANNEL_ICONS[ch.id] || "📡"}
                        </span>
                        <h3 className="font-medium text-sm">{ch.name}</h3>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${status.color}`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {status.text}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {ch.description}
                    </p>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Inactive / unconfigured channels */}
        {inactive.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Available Channels
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {inactive.map((ch) => {
                const status = statusLabel(ch);
                return (
                  <Card
                    key={ch.id}
                    className="p-4 space-y-2 opacity-70 hover:opacity-100 transition-opacity"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {CHANNEL_ICONS[ch.id] || "📡"}
                        </span>
                        <h3 className="font-medium text-sm">{ch.name}</h3>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${status.color}`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {status.text}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {ch.description}
                    </p>
                    {ch.required_env_keys.length > 0 && !ch.keys_configured && (
                      <div className="pt-1">
                        <p className="text-[10px] text-muted-foreground mb-1">
                          Required environment variables:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {ch.required_env_keys.map((key) => (
                            <Badge
                              key={key}
                              variant="outline"
                              className="text-[10px] font-mono"
                            >
                              {key}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
