export type PhaseStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type PhaseKind = "plan" | "research" | "draft" | "critique" | "revise" | "write";
export type TurnStatus = "running" | "completed" | "failed";
export type TaskStatus = TurnStatus;
export type TaskMode = "quick" | "standard" | "deep";

export const TASK_MODE_META: Record<
  TaskMode,
  { label: string; description: string; estimatedCalls: string }
> = {
  quick: {
    label: "Quick",
    description: "Direct single-shot report. Fastest.",
    estimatedCalls: "~1 call",
  },
  standard: {
    label: "Standard",
    description: "Plan → parallel research → draft. Balanced.",
    estimatedCalls: "~3–5 calls",
  },
  deep: {
    label: "Deep",
    description: "Full pipeline with self-critique and revision.",
    estimatedCalls: "~5–9 calls",
  },
};

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface TaskEvent {
  event: string;
  timestamp: number;
  tool?: string;
  preview?: string;
  duration?: number;
  error?: boolean;
  delta?: string;
  text?: string;
  output?: string;
  usage?: TokenUsage;
}

export interface Phase {
  id: number;
  turnId: number;
  seq: number;      // 0=plan, 1=research, 2=draft, 3=critique, 4=revise
  branch: number;   // 0 for sequential; 0..N for parallel research
  kind: PhaseKind;
  label: string;
  runId: string | null;
  output: string;
  status: PhaseStatus;
  error?: string;
  createdAt: number;
  completedAt?: number;
  usage?: TokenUsage;
  toolCount: number;
}

export interface PhaseDetail extends Phase {
  events: TaskEvent[];
}

export interface Turn {
  id: number;
  seq: number;
  userMessage: string;
  report: string;
  status: TurnStatus;
  error?: string;
  createdAt: number;
  completedAt?: number;
  usage?: TokenUsage;
  phaseCount: number;
}

export interface TurnDetail extends Turn {
  phases: PhaseDetail[];
}

export interface PipelineProgress {
  current: string;   // label of currently running phase
  done: number;
  total: number;
}

export interface Task {
  id: string;
  goal: string;
  context: string;
  toolsets: string[];
  mode: TaskMode;
  language: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  status: TaskStatus;
  result: string;
  error?: string;
  completedAt?: number;
  usage?: TokenUsage;
  turnCount: number;
  progress?: PipelineProgress;
}

export interface TaskDetail extends Task {
  turns: TurnDetail[];
}

export interface CreateTaskRequest {
  goal: string;
  context?: string;
  toolsets?: string[];
  mode?: TaskMode;
  language?: string;
}

export interface FollowupRequest {
  message: string;
}

export interface ListTasksResponse {
  tasks: Task[];
  total: number;
}

// Pipeline contract ---------------------------------------------------------

export interface ResearchQuestion {
  id: string;
  title: string;
  approach: string;
}

export interface Plan {
  sections: string[];
  questions: ResearchQuestion[];
}
