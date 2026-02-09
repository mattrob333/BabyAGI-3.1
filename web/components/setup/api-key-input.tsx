"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ApiKeyInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  configured?: boolean;
}

export function ApiKeyInput({ value, onChange, placeholder, id, configured }: ApiKeyInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {configured && !value && (
        <span
          className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-green-500/20 text-green-500"
          title="Connected"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6l2.5 2.5 4.5-5" />
          </svg>
        </span>
      )}
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={configured && !value ? "Already configured" : placeholder}
        className={`font-mono text-sm ${configured && !value ? "border-green-500/30" : ""}`}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 w-16"
        onClick={() => setVisible(!visible)}
      >
        {visible ? "Hide" : "Show"}
      </Button>
    </div>
  );
}
