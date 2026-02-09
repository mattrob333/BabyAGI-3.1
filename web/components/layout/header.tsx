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

  const navLinks = [
    { href: "/", label: "Chat" },
    { href: "/tasks", label: "Tasks" },
    { href: "/tools", label: "Tools" },
    { href: "/memory", label: "Memory" },
    { href: "/metrics", label: "Metrics" },
    { href: "/channels", label: "Channels" },
    { href: "/credentials", label: "Keys" },
    { href: "/setup", label: "Setup" },
  ];

  return (
    <header className="flex items-center justify-between px-4 h-14 border-b bg-background shrink-0 min-w-0">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <Link href="/" className="font-semibold text-lg shrink-0">
          BabyAGI 3
        </Link>
        <nav className="flex items-center gap-3 text-sm overflow-x-auto scrollbar-none min-w-0">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`shrink-0 ${
                pathname === href
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-2 text-sm shrink-0 ml-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            connected === null
              ? "bg-muted-foreground"
              : connected
                ? "bg-green-500"
                : "bg-red-500"
          }`}
        />
        <span className="text-muted-foreground hidden sm:inline">
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
