"use client";

import { useState, useCallback, useRef } from "react";
import { apiStreamUrl, apiFetch, getAuthHeaders } from "./api";
import type { Message, ToolEvent, ThreadInfo, MessageWithTools, ContentBlock, TextBlock } from "./types";

function extractContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is TextBlock => b.type === "text" || "text" in b)
      .map((b) => b.text || "")
      .join("");
  }
  return String(content ?? "");
}

function normalizeMessages(raw: { role: string; content: string | ContentBlock[] }[]): Message[] {
  return raw
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: extractContent(m.content) }))
    .filter((m) => m.content.length > 0);
}

export function useChat(initialThreadId: string = "web") {
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState<MessageWithTools[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [pendingToolEvents, setPendingToolEvents] = useState<ToolEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const pendingToolsRef = useRef<ToolEvent[]>([]);
  const streamingTextRef = useRef("");

  const loadThread = useCallback(async (tid?: string) => {
    const target = tid || threadId;
    try {
      const data = await apiFetch<{ messages: { role: string; content: string | ContentBlock[] }[] }>(
        `/threads/${target}`
      );
      if (data.messages) {
        setMessages(normalizeMessages(data.messages).map((m) => ({ ...m, toolEvents: [] })));
      }
    } catch {
      setMessages([]);
    }
  }, [threadId]);

  const loadThreads = useCallback(async () => {
    try {
      const data = await apiFetch<{ threads: ThreadInfo[] }>("/threads");
      setThreads(data.threads || []);
    } catch {
      // ignore
    }
  }, []);

  const switchThread = useCallback(async (newThreadId: string) => {
    setThreadId(newThreadId);
    setMessages([]);
    setToolEvents([]);
    setPendingToolEvents([]);
    try {
      const data = await apiFetch<{ messages: { role: string; content: string | ContentBlock[] }[] }>(
        `/threads/${newThreadId}`
      );
      if (data.messages) {
        setMessages(normalizeMessages(data.messages).map((m) => ({ ...m, toolEvents: [] })));
      }
    } catch {
      setMessages([]);
    }
  }, []);

  const clearThread = useCallback(async () => {
    try {
      await apiFetch(`/threads/${threadId}`, { method: "DELETE" });
      setMessages([]);
    } catch {
      // ignore
    }
  }, [threadId]);

  const newThread = useCallback(() => {
    const id = `web_${Date.now()}`;
    setThreadId(id);
    setMessages([]);
    setToolEvents([]);
    setPendingToolEvents([]);
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsLoading(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const userMessage: MessageWithTools = { role: "user", content, toolEvents: [] };
      setMessages((prev) => [...prev, userMessage]);
      setToolEvents([]);
      setPendingToolEvents([]);
      setStreamingText("");
      pendingToolsRef.current = [];
      streamingTextRef.current = "";
      setIsLoading(true);

      abortRef.current = new AbortController();

      try {
        const res = await fetch(apiStreamUrl("/message/stream"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ content, thread_id: threadId }),
          signal: abortRef.current.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Stream failed: ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ") && eventType) {
              try {
                const payload = JSON.parse(line.slice(6));
                if (eventType === "tool_start") {
                  const evt: ToolEvent = { type: "tool_start", name: payload.name, input: payload.input };
                  pendingToolsRef.current = [...pendingToolsRef.current, evt];
                  setPendingToolEvents([...pendingToolsRef.current]);
                  setToolEvents((prev) => [...prev, evt]);
                } else if (eventType === "tool_end") {
                  const evt: ToolEvent = {
                    type: "tool_end",
                    name: payload.name,
                    result: payload.result,
                    duration_ms: payload.duration_ms,
                  };
                  pendingToolsRef.current = [...pendingToolsRef.current, evt];
                  setPendingToolEvents([...pendingToolsRef.current]);
                  setToolEvents((prev) => [...prev, evt]);
                } else if (eventType === "text_delta") {
                  streamingTextRef.current += payload.text;
                  setStreamingText(streamingTextRef.current);
                } else if (eventType === "text_clear") {
                  streamingTextRef.current = "";
                  setStreamingText("");
                } else if (eventType === "message_done") {
                  const assistantMessage: MessageWithTools = {
                    role: "assistant",
                    content: payload.response,
                    toolEvents: [...pendingToolsRef.current],
                  };
                  pendingToolsRef.current = [];
                  streamingTextRef.current = "";
                  setPendingToolEvents([]);
                  setStreamingText("");
                  setMessages((prev) => [...prev, assistantMessage]);
                } else if (eventType === "error") {
                  const errorMessage: MessageWithTools = {
                    role: "assistant",
                    content: `Error: ${payload.error}`,
                    toolEvents: [...pendingToolsRef.current],
                  };
                  pendingToolsRef.current = [];
                  streamingTextRef.current = "";
                  setPendingToolEvents([]);
                  setStreamingText("");
                  setMessages((prev) => [...prev, errorMessage]);
                }
              } catch {
                // skip malformed data lines
              }
              eventType = "";
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Connection error: ${(err as Error).message}`,
              toolEvents: [],
            },
          ]);
        }
      } finally {
        setIsLoading(false);
        setToolEvents([]);
        setPendingToolEvents([]);
        setStreamingText("");
        pendingToolsRef.current = [];
        streamingTextRef.current = "";
        abortRef.current = null;
        loadThreads();
      }
    },
    [threadId, isLoading, loadThreads]
  );

  return {
    threadId,
    messages,
    toolEvents,
    pendingToolEvents,
    isLoading,
    streamingText,
    threads,
    sendMessage,
    loadThread,
    loadThreads,
    switchThread,
    clearThread,
    newThread,
    setMessages,
    stop,
  };
}
