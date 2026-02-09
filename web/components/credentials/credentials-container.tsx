"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Secret {
  name: string;
  source: string;
  masked_value: string;
}

interface Credential {
  service: string;
  credential_type: string;
  username?: string;
  email?: string;
  card_last_four?: string;
  card_type?: string;
}

export function CredentialsContainer() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add secret form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [secretsData, credsData] = await Promise.all([
        apiFetch<{ secrets: Secret[]; count: number }>("/secrets"),
        apiFetch<{ credentials: Credential[]; count: number }>("/credentials"),
      ]);
      setSecrets(secretsData.secrets || []);
      setCredentials(credsData.credentials || []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleAddSecret() {
    if (!newName.trim() || !newValue.trim()) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await apiFetch<{ stored: boolean; env_var?: string; error?: string }>(
        "/secrets",
        {
          method: "POST",
          body: JSON.stringify({ name: newName.trim(), value: newValue.trim() }),
        }
      );
      if (res.stored) {
        setSaveResult(`Stored as ${res.env_var || newName}`);
        setNewName("");
        setNewValue("");
        setShowAddForm(false);
        fetchData();
      } else {
        setSaveResult(`Error: ${res.error || "Unknown error"}`);
      }
    } catch (err) {
      setSaveResult(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSecret(name: string) {
    if (!confirm(`Delete secret "${name}"?`)) return;
    try {
      await apiFetch(`/secrets/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      fetchData();
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading credentials...
      </div>
    );
  }

  if (error) {
    const isConnectionError =
      error.includes("fetch") ||
      error.includes("NetworkError") ||
      error.includes("Failed") ||
      error.includes("404");
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <p className="text-destructive text-sm">
          {isConnectionError
            ? "Cannot reach the backend server."
            : `Failed to load credentials: ${error}`}
        </p>
        <p className="text-xs text-muted-foreground max-w-md">
          {isConnectionError
            ? "Make sure the BabyAGI backend is running and has been restarted to pick up the latest API endpoints. Run: python main.py serve"
            : "The server may need to be restarted."}
        </p>
        <Button variant="outline" size="sm" onClick={fetchData}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Credentials & API Keys</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Securely stored in the system keyring. Values are never displayed
              in full.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? "Cancel" : "+ Add API Key"}
          </Button>
        </div>

        {/* Add secret form */}
        {showAddForm && (
          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-semibold">Add API Key / Secret</h2>
            <p className="text-xs text-muted-foreground">
              Use the full environment variable name (e.g.,{" "}
              <code className="bg-muted px-1 py-0.5 rounded">
                FIRECRAWL_API_KEY
              </code>
              ,{" "}
              <code className="bg-muted px-1 py-0.5 rounded">
                BRAVE_API_KEY
              </code>
              ,{" "}
              <code className="bg-muted px-1 py-0.5 rounded">
                EXA_API_KEY
              </code>
              ). The key will be stored in the system keyring and set as an
              environment variable.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="FIRECRAWL_API_KEY"
                className="flex-1 px-3 py-2 rounded-md border bg-background text-sm outline-none focus:border-foreground/30"
              />
              <input
                type="password"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="sk-..."
                className="flex-1 px-3 py-2 rounded-md border bg-background text-sm outline-none focus:border-foreground/30"
              />
              <Button
                size="sm"
                onClick={handleAddSecret}
                disabled={saving || !newName.trim() || !newValue.trim()}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
            {saveResult && (
              <p
                className={`text-xs ${
                  saveResult.startsWith("Error")
                    ? "text-destructive"
                    : "text-green-400"
                }`}
              >
                {saveResult}
              </p>
            )}
          </Card>
        )}

        {/* API Keys / Secrets */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              API Keys & Secrets
            </h2>
            <Badge variant="secondary">{secrets.length} keys</Badge>
          </div>

          {secrets.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No API keys found. Add keys using the button above or set them
                in your{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  .env
                </code>{" "}
                file.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {secrets.map((secret) => (
                <Card
                  key={secret.name}
                  className="p-3 space-y-1.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-mono text-xs font-medium truncate">
                      {secret.name}
                    </h3>
                    <button
                      onClick={() => handleDeleteSecret(secret.name)}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {secret.masked_value}
                    </code>
                    <Badge variant="outline" className="text-[10px]">
                      {secret.source}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Stored Credentials (accounts, payment methods) */}
        {credentials.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Stored Accounts & Credentials
              </h2>
              <Badge variant="secondary">{credentials.length} accounts</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {credentials.map((cred, i) => (
                <Card
                  key={`${cred.service}-${i}`}
                  className="p-3 space-y-1.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium text-sm truncate">
                      {cred.service}
                    </h3>
                    <Badge variant="outline" className="text-[10px]">
                      {cred.credential_type === "credit_card"
                        ? "💳 Card"
                        : "👤 Account"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {cred.username && <p>Username: {cred.username}</p>}
                    {cred.email && <p>Email: {cred.email}</p>}
                    {cred.card_last_four && (
                      <p>
                        Card: {cred.card_last_four}{" "}
                        {cred.card_type && `(${cred.card_type})`}
                      </p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Help text */}
        <Card className="p-4 space-y-2 bg-muted/20">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            How credentials work
          </h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>
              <strong>API Keys</strong> are stored in the system keyring
              (Windows Credential Locker / macOS Keychain) and set as
              environment variables.
            </li>
            <li>
              <strong>Account credentials</strong> (usernames, passwords) are
              stored with metadata in the database and secrets in the keyring.
            </li>
            <li>
              <strong>Payment methods</strong> are stored securely — only the
              last 4 digits are visible. Full card numbers are never exposed.
            </li>
            <li>
              You can also ask BabyAGI in chat to store API keys:{" "}
              <em>&quot;Store my FireCrawl API key: sk-...&quot;</em>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
