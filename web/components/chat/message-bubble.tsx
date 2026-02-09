"use client";

import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageWithTools } from "@/lib/types";
import { InlineToolEvents } from "./inline-tool-events";

interface MessageBubbleProps {
  message: MessageWithTools;
}

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300 break-all"
      {...props}
    >
      {children}
    </a>
  ),
};

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => typeof b === "object" && b !== null && (b.type === "text" || b.text))
      .map((b) => b.text ?? "")
      .join("");
  }
  if (typeof content === "object" && content !== null && "text" in content) {
    return (content as { text: string }).text;
  }
  return String(content ?? "");
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const text = toText(message.content);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs mt-0.5">
        <div className="w-full h-full rounded-full bg-muted flex items-center justify-center">
          🧒
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium mb-1 text-muted-foreground">BabyAGI</p>
        {message.toolEvents && message.toolEvents.length > 0 && (
          <InlineToolEvents events={message.toolEvents} />
        )}
        <div className="text-sm prose prose-sm prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
