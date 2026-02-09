"use client";

import { useEffect, useRef, useCallback } from "react";
import type { ToolEvent, MessageWithTools } from "@/lib/types";
import { MessageBubble } from "./message-bubble";
import { InlineToolEvents } from "./inline-tool-events";

interface MessageListProps {
  messages: MessageWithTools[];
  pendingToolEvents?: ToolEvent[];
  isLoading?: boolean;
}

export function MessageList({ messages, pendingToolEvents = [], isLoading = false }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      // Use scrollTop instead of scrollIntoView to avoid affecting parent scroll containers
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
  }, []);

  // Auto-scroll when new messages arrive or tool events update
  useEffect(() => {
    // Reset the manual-scroll flag when the user sends a new message
    // (i.e. messages array grows)
    userScrolledUp.current = false;
    scrollToBottom("smooth");
  }, [messages.length, scrollToBottom]);

  // Scroll on pending tool events (loading indicators) unless user manually scrolled up
  useEffect(() => {
    if (!userScrolledUp.current) {
      scrollToBottom("smooth");
    }
  }, [pendingToolEvents.length, scrollToBottom]);

  // Also scroll instantly when the message list is first populated (e.g. loading a thread)
  useEffect(() => {
    if (messages.length > 0) {
      // Use a short timeout to let the DOM render the messages first
      const timer = setTimeout(() => scrollToBottom("instant"), 50);
      return () => clearTimeout(timer);
    }
  }, [messages, scrollToBottom]);

  // Detect when user manually scrolls up so we don't fight their scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function handleScroll() {
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      // If user is within 100px of the bottom, consider them "at bottom"
      userScrolledUp.current = distanceFromBottom > 100;
    }

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-muted-foreground gap-3 px-4">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-2xl">
          🧒
        </div>
        <div className="text-center">
          <p className="text-base font-medium text-foreground">BabyAGI</p>
          <p className="text-sm mt-1">How can I help you today?</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div className="max-w-3xl mx-auto py-4 px-4 space-y-6">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {isLoading && (
          <div className="flex gap-3 items-start">
            <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs mt-0.5">
              <div className="w-full h-full rounded-full bg-muted flex items-center justify-center">
                🧒
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium mb-1 text-muted-foreground">BabyAGI</p>
              {pendingToolEvents.length > 0 ? (
                <InlineToolEvents events={pendingToolEvents} />
              ) : (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span className="inline-flex gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="ml-1">Thinking…</span>
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
