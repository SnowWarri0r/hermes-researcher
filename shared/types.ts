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

// ---------------------------------------------------------------------------
// Model routing config
// ---------------------------------------------------------------------------
export interface ModelRouting {
  plan: string;       // cheap/fast model for planning
  research: string;   // strong model for research (needs tools)
  draft: string;      // strong model for writing
  critique: string;   // cheap model for review
  revise: string;     // strong model for final output
}

export type EmbeddingProvider = "openai" | "volcengine" | "ollama";

export interface EmbeddingSettings {
  provider: EmbeddingProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  dimensions: number;   // 0 = auto-detect on test
}

export const DEFAULT_MODEL_ROUTING: ModelRouting = {
  plan: "",       // empty = use hermes default
  research: "",
  draft: "",
  critique: "",
  revise: "",
};

// ---------------------------------------------------------------------------
// Task templates
// ---------------------------------------------------------------------------
export interface TemplateVariable {
  name: string;
  label: string;
  type: "text" | "select" | "number";
  options?: string[];      // for select type
  defaultValue?: string;
  placeholder?: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  goal: string;            // contains {varName} placeholders
  context: string;
  toolsets: string[];
  mode: TaskMode;
  language: string;
  variables: TemplateVariable[];
  createdAt: number;
}

export interface ListTasksResponse {
  tasks: Task[];
  total: number;
  /** Unfiltered counts across the full set — independent of the current
   *  `status` filter so UI controls can show correct badges. */
  counts: { running: number; completed: number; failed: number; all: number };
}

// Pipeline contract ---------------------------------------------------------

export interface ResearchQuestion {
  id: string;
  title: string;
  approach: string;
  /** Optional prerequisite question IDs. Research executor runs this question
   *  only after its prerequisites complete, and passes their outputs as context. */
  depends_on?: string[];
}

export interface Plan {
  sections: string[];
  questions: ResearchQuestion[];
}

// Thesis phase output (narrative arc) -----------------------------------

export interface ThesisSubClaim {
  id: string;             // "C1", "C2", ...
  text: string;           // the sub-claim itself
  evidence_from: string[]; // Q# IDs like ["Q1", "Q3"]
}

export interface ThesisSectionPlanEntry {
  section: string;         // section name, verbatim from plan.sections
  sub_claim: string | null; // "C1"/"C2"/... or null for TL;DR/closer
  role: string;            // must include a connective instruction
}

export interface ParsedThesis {
  central_claim: string;
  sub_claims: ThesisSubClaim[];
  section_plan: ThesisSectionPlanEntry[];
}

// Post-report chat (read-enabled + tool-enabled Q&A) -----------------------

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: number;
  taskId: string;
  turnId: number | null;
  role: ChatRole;
  content: string;
  events?: TaskEvent[];
  usage?: TokenUsage;
  status: "running" | "completed" | "failed";
  error?: string;
  createdAt: number;
  completedAt?: number;
}
