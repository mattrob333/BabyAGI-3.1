"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";

export function Header() {
  const pathname = usePathname();
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        await apiFetch<HealthResponse>("/health");
        if (active) setConnected(true);
      } catch {
        if (active) setConnected(false);
      }
    }

    check();
    const id = setInterval(check, 10000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <header className="flex items-center justify-between px-4 h-14 border-b bg-background shrink-0">
      <div className="flex items-center gap-6">
        <Link href="/" className="font-semibold text-lg">
          BabyAGI
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/"
            className={
              pathname === "/" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }
          >
            Chat
          </Link>
          <Link
            href="/tasks"
            className={
              pathname === "/tasks"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            Tasks
          </Link>
          <Link
            href="/tools"
            className={
              pathname === "/tools"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            Tools
          </Link>
          <Link
            href="/memory"
            className={
              pathname === "/memory"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            Memory
          </Link>
          <Link
            href="/metrics"
            className={
              pathname === "/metrics"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            Metrics
          </Link>
          <Link
            href="/channels"
            className={
              pathname === "/channels"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            Channels
          </Link>
          <Link
            href="/credentials"
            className={
              pathname === "/credentials"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            Keys
          </Link>
          <Link
            href="/setup"
            className={
              pathname === "/setup"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            Setup
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            connected === null
              ? "bg-muted-foreground"
              : connected
                ? "bg-green-500"
                : "bg-red-500"
          }`}
        />
        <span className="text-muted-foreground">
          {connected === null
            ? "Checking..."
            : connected
              ? "Connected"
              : "Disconnected"}
        </span>
      </div>
    </header>
  );
}
