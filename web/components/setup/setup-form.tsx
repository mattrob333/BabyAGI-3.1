"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ApiKeyInput } from "./api-key-input";
import { apiFetch } from "@/lib/api";
import type { SetupStatusResponse, SetupFormData } from "@/lib/types";

interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

const EMPTY_FORM: SetupFormData = {
  owner_name: "",
  owner_email: "",
  owner_bio: "",
  owner_goal: "",
  owner_phone: "",
  owner_timezone: "",
  agent_name: "Assistant",
  agentmail_api_key: "",
  sendblue_api_key: "",
  sendblue_api_secret: "",
  sendblue_phone_number: "",
  composio_api_key: "",
};

export function SetupForm() {
  const router = useRouter();
  const [form, setForm] = useState<SetupFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState({
    agentmail: false,
    sendblue: false,
    composio: false,
  });
  const [agentEmail, setAgentEmail] = useState("");
  const [activeModel, setActiveModel] = useState("");
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [modelSaving, setModelSaving] = useState(false);
  const [formLoading, setFormLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const status = await apiFetch<SetupStatusResponse>("/setup/status");
        const c = status.config;
        setForm((prev) => ({
          ...prev,
          owner_name: c.owner_name || "",
          owner_email: c.owner_email || "",
          owner_bio: c.owner_bio || "",
          owner_goal: c.owner_goal || "",
          owner_phone: c.owner_phone || "",
          owner_timezone: c.owner_timezone || "",
          agent_name: c.agent_name || "Assistant",
          sendblue_phone_number: c.sendblue_phone_number || "",
        }));
        setConfigured({
          agentmail: c.agentmail_configured || false,
          sendblue: c.sendblue_configured || false,
          composio: c.composio_configured || false,
        });
        if (c.agent_email) setAgentEmail(c.agent_email);
      } catch {
        // Backend not reachable - use empty form
      } finally {
        setFormLoading(false);
      }
    }
    load();

    async function loadModels() {
      try {
        const res = await apiFetch<{
          active_model: string;
          available_models: ModelOption[];
        }>("/config/model");
        setActiveModel(res.active_model);
        setAvailableModels(res.available_models);
      } catch {
        // Backend not reachable
      }
    }
    loadModels();
  }, []);

  function update(field: keyof SetupFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!form.owner_name.trim() || !form.owner_email.trim()) {
      setError("Name and email are required.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/setup/complete", {
        method: "POST",
        body: JSON.stringify(form),
      });
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (formLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground py-20">
        Loading settings...
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl mx-auto py-8 px-4 pb-16">
      <div>
        <h1 className="text-2xl font-bold">Setup BabyAGI</h1>
        <p className="text-muted-foreground mt-1">
          Configure your AI agent. Only name and email are required.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
          {error}
        </div>
      )}

      {/* Owner Info */}
      <Card>
        <CardHeader>
          <CardTitle>Owner Info</CardTitle>
          <CardDescription>Tell the agent about yourself.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="owner_name">Name *</Label>
              <Input
                id="owner_name"
                value={form.owner_name}
                onChange={(e) => update("owner_name", e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner_email">Email *</Label>
              <Input
                id="owner_email"
                type="email"
                value={form.owner_email}
                onChange={(e) => update("owner_email", e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="owner_bio">Bio</Label>
            <Textarea
              id="owner_bio"
              value={form.owner_bio}
              onChange={(e) => update("owner_bio", e.target.value)}
              placeholder="Who you are, what you do (helps the agent personalize)"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="owner_goal">Goal</Label>
            <Textarea
              id="owner_goal"
              value={form.owner_goal}
              onChange={(e) => update("owner_goal", e.target.value)}
              placeholder="How you want the agent to help you"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="owner_phone">Phone</Label>
              <Input
                id="owner_phone"
                value={form.owner_phone}
                onChange={(e) => update("owner_phone", e.target.value)}
                placeholder="+15551234567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner_timezone">Timezone</Label>
              <Input
                id="owner_timezone"
                value={form.owner_timezone}
                onChange={(e) => update("owner_timezone", e.target.value)}
                placeholder="America/New_York"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent_name">Agent Name</Label>
            <Input
              id="agent_name"
              value={form.agent_name}
              onChange={(e) => update("agent_name", e.target.value)}
              placeholder="Assistant"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent_model">Default Model</Label>
            {availableModels.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  id="agent_model"
                  value={activeModel}
                  onChange={async (e) => {
                    const newModel = e.target.value;
                    setModelSaving(true);
                    try {
                      await apiFetch("/config/model", {
                        method: "POST",
                        body: JSON.stringify({ model: newModel }),
                      });
                      setActiveModel(newModel);
                    } catch {
                      // revert on failure
                    } finally {
                      setModelSaving(false);
                    }
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground"
                  disabled={modelSaving}
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {modelSaving && (
                  <span className="text-xs text-muted-foreground">Saving...</span>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Connect to backend to see available models</p>
            )}
            <p className="text-xs text-muted-foreground">
              The AI model used for agent responses. Changes take effect immediately.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>
            Optional. You can add these later via environment variables or by telling the agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agentmail_api_key">AgentMail API Key</Label>
            <ApiKeyInput
              id="agentmail_api_key"
              value={form.agentmail_api_key}
              onChange={(v) => update("agentmail_api_key", v)}
              placeholder="Get one at agentmail.to"
              configured={configured.agentmail}
            />
            {agentEmail && (
              <div className="flex items-center gap-2 mt-1 px-1">
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-green-500/20 text-green-500 shrink-0">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6l2.5 2.5 4.5-5" />
                  </svg>
                </span>
                <span className="text-xs text-muted-foreground">
                  Agent email:{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono text-[11px]">
                    {agentEmail}
                  </code>
                </span>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="sendblue_api_key">SendBlue API Key</Label>
            <ApiKeyInput
              id="sendblue_api_key"
              value={form.sendblue_api_key}
              onChange={(v) => update("sendblue_api_key", v)}
              placeholder="Get one at sendblue.co"
              configured={configured.sendblue}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sendblue_api_secret">SendBlue API Secret</Label>
            <ApiKeyInput
              id="sendblue_api_secret"
              value={form.sendblue_api_secret}
              onChange={(v) => update("sendblue_api_secret", v)}
              configured={configured.sendblue}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sendblue_phone_number">SendBlue Phone Number</Label>
            <Input
              id="sendblue_phone_number"
              value={form.sendblue_phone_number}
              onChange={(e) => update("sendblue_phone_number", e.target.value)}
              placeholder="+15551234567 (from SendBlue dashboard)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="composio_api_key">Composio API Key</Label>
            <ApiKeyInput
              id="composio_api_key"
              value={form.composio_api_key}
              onChange={(v) => update("composio_api_key", v)}
              placeholder="Get one at app.composio.dev"
              configured={configured.composio}
            />
          </div>
        </CardContent>
      </Card>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Saving..." : "Complete Setup"}
      </Button>
    </form>
  );
}
