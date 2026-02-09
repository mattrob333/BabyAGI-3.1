"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface QuickAction {
  label: string;
  prompt: string;
  icon?: string;
}

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  quickActions?: QuickAction[];
  showQuickActions?: boolean;
}

export function MessageInput({
  onSend,
  disabled,
  quickActions = [],
  showQuickActions = false,
}: MessageInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  }, [value, onSend]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFileClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    // Upload to backend (use same-origin via Next.js rewrites)
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`/files/upload`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        const mention = `[Attached file: ${data.filename} (${data.size_bytes} bytes)]`;
        setValue((prev) => (prev ? `${prev}\n${mention}` : mention));
      } else {
        const mention = `[Attached: ${file.name}]`;
        setValue((prev) => (prev ? `${prev}\n${mention}` : mention));
      }
    } catch {
      const mention = `[Attached: ${file.name}]`;
      setValue((prev) => (prev ? `${prev}\n${mention}` : mention));
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  // Track the virtual keyboard on mobile so we can adjust the bottom offset.
  // When the keyboard opens, visualViewport.height shrinks while window.innerHeight
  // stays the same. We compute the difference and apply it as a CSS variable on this
  // component so it can shift up above the keyboard.
  const containerRef = useRef<HTMLDivElement>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function onResize() {
      // The difference between the layout viewport and the visual viewport
      // gives us the keyboard height on mobile browsers.
      const offset = window.innerHeight - (vv!.height + vv!.offsetTop);
      setKeyboardOffset(Math.max(0, offset));
    }

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);

  // Scroll textarea into view when keyboard opens (helps on iOS)
  useEffect(() => {
    if (keyboardOffset > 0 && textareaRef.current) {
      // Small delay to let the layout settle
      const timer = setTimeout(() => {
        textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [keyboardOffset]);

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div
      ref={containerRef}
      className="shrink-0 pt-2 px-4"
      style={{
        paddingBottom: `max(${keyboardOffset}px + 0.75rem, env(safe-area-inset-bottom, 0.75rem))`,
        transition: "padding-bottom 0.1s ease-out",
      }}
    >
      <div className="max-w-3xl mx-auto space-y-2">
        {/* Quick action chips — shown when chat is empty */}
        {showQuickActions && quickActions.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center">
            {quickActions.map((action, i) => (
              <button
                key={i}
                onClick={() => onSend(action.prompt)}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
              >
                {action.icon && <span>{action.icon}</span>}
                {action.label}
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-2 rounded-2xl border bg-muted/50 px-3 py-2 focus-within:border-foreground/20 transition-colors">
          {/* File upload button */}
          <button
            onClick={handleFileClick}
            disabled={disabled}
            className="shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            title="Attach file"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 7.5l-5.6 5.6a3.2 3.2 0 01-4.5-4.5l5.6-5.6a2.1 2.1 0 013 3L6.4 11.6a1.1 1.1 0 01-1.5-1.5L10.5 4.5" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message BabyAGI..."
            className="flex-1 bg-transparent text-base sm:text-sm resize-none outline-none placeholder:text-muted-foreground min-h-[24px] max-h-[200px] py-1"
            rows={1}
            disabled={disabled}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-colors ${
              canSend
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
            title="Send message"
          >
            {disabled ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="animate-spin">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 12V4M4 7l4-4 4 4" />
              </svg>
            )}
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground text-center">
          Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
