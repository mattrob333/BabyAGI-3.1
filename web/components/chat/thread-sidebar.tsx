"use client";

import type { ThreadInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ThreadSidebarProps {
  threads: ThreadInfo[];
  activeThreadId: string;
  open: boolean;
  onClose: () => void;
  onSelect: (threadId: string) => void;
  onNewChat: () => void;
}

export function ThreadSidebar({
  threads,
  activeThreadId,
  open,
  onClose,
  onSelect,
  onNewChat,
}: ThreadSidebarProps) {
  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <div
        className={cn(
          "flex flex-col bg-card border-r z-40 transition-all duration-200 shrink-0",
          "absolute lg:relative h-full",
          open ? "w-64 translate-x-0" : "w-0 -translate-x-full lg:translate-x-0 lg:w-0 overflow-hidden"
        )}
      >
        <div className="flex items-center justify-between px-3 h-10 border-b shrink-0">
          <span className="text-xs font-medium text-foreground">Chats</span>
          <button
            onClick={onNewChat}
            className="px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            + New
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {threads.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                No conversations yet
              </p>
            ) : (
              threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => onSelect(thread.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-xs transition-colors",
                    thread.id === activeThreadId
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <div className="truncate font-medium">{thread.title}</div>
                  <div className="truncate opacity-60 mt-0.5">
                    {thread.message_count} messages
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
