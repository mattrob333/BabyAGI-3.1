"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/lib/use-chat";
import { apiFetch } from "@/lib/api";
import type { SetupStatusResponse, ScheduledTask } from "@/lib/types";
import { MessageList } from "./message-list";
import { MessageInput, type QuickAction } from "./message-input";
import { ThreadSidebar } from "./thread-sidebar";

// Built-in quick actions that are always available
const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  {
    label: "What can you do?",
    prompt: "What tools and capabilities do you have? Give me a summary.",
    icon: "💡",
  },
  {
    label: "Check my tasks",
    prompt: "What scheduled tasks do I have? Show me their status.",
    icon: "📋",
  },
  {
    label: "Connect a service",
    prompt:
      "Help me connect a new service via Composio. What integrations are available?",
    icon: "🔗",
  },
];

export function ChatContainer() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quickActions, setQuickActions] = useState<QuickAction[]>(
    DEFAULT_QUICK_ACTIONS
  );
  const {
    threadId,
    messages,
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
  } = useChat("web");

  useEffect(() => {
    async function init() {
      try {
        const status = await apiFetch<SetupStatusResponse>("/setup/status");
        if (!status.initialized) {
          router.push("/setup");
          return;
        }
      } catch {
        // Backend not reachable — still show chat
      }
      loadThread();
      loadThreads();

      // Load scheduled tasks as quick actions
      try {
        const data = await apiFetch<{ tasks: ScheduledTask[] }>(
          "/scheduler/tasks"
        );
        if (data.tasks && data.tasks.length > 0) {
          const taskActions: QuickAction[] = data.tasks
            .filter((t) => t.enabled)
            .slice(0, 3)
            .map((t) => ({
              label: `Run: ${t.name}`,
              prompt: `Run my scheduled task "${t.name}" now. Its goal is: ${t.goal}`,
              icon: "⚡",
            }));
          setQuickActions([...DEFAULT_QUICK_ACTIONS, ...taskActions]);
        }
      } catch {
        // Tasks endpoint may not be available yet
      }
    }
    init();
  }, [router, loadThread, loadThreads]);

  function handleNewChat() {
    newThread();
    setSidebarOpen(false);
  }

  function handleSwitchThread(id: string) {
    switchThread(id);
    setSidebarOpen(false);
  }

  async function handleClearChat() {
    await clearThread();
    loadThreads();
  }

  return (
    <div className="flex h-full relative overflow-hidden">
      {/* Sidebar */}
      <ThreadSidebar
        threads={threads}
        activeThreadId={threadId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={handleSwitchThread}
        onNewChat={handleNewChat}
      />

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Chat toolbar */}
        <div className="flex items-center justify-between px-4 h-10 border-b shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Toggle chat history"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M2 4h12M2 8h12M2 12h12" />
              </svg>
            </button>
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {threadId === "web"
                ? "Main Chat"
                : threadId.startsWith("web_")
                  ? "New Chat"
                  : threadId}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleNewChat}
              className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="New chat"
            >
              + New
            </button>
            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
                className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Clear chat"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Messages — flex-1 + min-h-0 ensures this scrolls, not the page */}
        <MessageList messages={messages} pendingToolEvents={pendingToolEvents} isLoading={isLoading} streamingText={streamingText} />
        <MessageInput
          onSend={sendMessage}
          disabled={isLoading}
          quickActions={quickActions}
          showQuickActions={messages.length === 0}
        />
      </div>
    </div>
  );
}
