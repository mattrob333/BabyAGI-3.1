export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
  timestamp?: string;
}

export interface ToolEvent {
  type: "tool_start" | "tool_end";
  name: string;
  input?: string;
  result?: string;
  duration_ms?: number;
}

export interface MessageWithTools extends Message {
  toolEvents: ToolEvent[];
}

export interface SetupConfig {
  owner_name: string;
  owner_email: string;
  owner_bio: string;
  owner_goal: string;
  owner_phone: string;
  owner_timezone: string;
  agent_name: string;
  agentmail_configured: boolean;
  agentmail_inbox_id: string;
  agent_email: string;
  sendblue_configured: boolean;
  sendblue_phone_number: string;
  composio_configured: boolean;
}

export interface SetupFormData {
  owner_name: string;
  owner_email: string;
  owner_bio: string;
  owner_goal: string;
  owner_phone: string;
  owner_timezone: string;
  agent_name: string;
  agentmail_api_key: string;
  sendblue_api_key: string;
  sendblue_api_secret: string;
  sendblue_phone_number: string;
  composio_api_key: string;
}

export interface HealthResponse {
  status: string;
  objectives_count: number;
  threads_count: number;
  tools: string[];
}

export interface SetupStatusResponse {
  initialized: boolean;
  config: SetupConfig;
}

export interface ScheduledTask {
  id: string;
  name: string;
  goal: string;
  schedule: string;
  schedule_raw: {
    kind: "at" | "every" | "cron";
    at: string | null;
    every: string | null;
    cron: string | null;
    tz: string | null;
  };
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_duration_ms?: number | null;
  run_count: number;
  created_at: string;
  thread_id?: string;
}

export interface TaskRun {
  started_at: string;
  completed_at: string | null;
  status: string;
  result: string | null;
  error: string | null;
  duration_ms: number | null;
}

export interface ToolInfo {
  name: string;
  description: string;
  type: string;
  usage_count?: number;
  depends_on?: string[];
}

export interface ThreadInfo {
  id: string;
  title: string;
  message_count: number;
  preview: string;
}

export interface ComposioConnection {
  id: string;
  app: string;
  status: string;
  created_at?: string;
  redirect_url?: string;
}
