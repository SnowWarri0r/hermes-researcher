import type { TaskEvent } from "../../shared/types.ts";

const HERMES_ENDPOINT =
  process.env.HERMES_ENDPOINT || "http://127.0.0.1:8642";
const HERMES_API_KEY = process.env.HERMES_API_KEY || "";

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (HERMES_API_KEY) h["Authorization"] = `Bearer ${HERMES_API_KEY}`;
  return h;
}

export async function hermesHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${HERMES_ENDPOINT}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Runs API — independent sessions, full SSE tool events
// Used for: research branches (parallel, need isolation)
// ---------------------------------------------------------------------------
export async function startHermesRun(
  input: string,
  model?: string,
  conversationHistory?: { role: string; content: string }[]
): Promise<string> {
  const body: Record<string, unknown> = { input, store: true };
  if (model) body.model = model;
  if (conversationHistory?.length) body.conversation_history = conversationHistory;
  const res = await fetch(`${HERMES_ENDPOINT}/v1/runs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Hermes run failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { run_id: string };
  return data.run_id;
}

export async function* streamHermesEvents(
  runId: string,
  signal?: AbortSignal
): AsyncGenerator<TaskEvent> {
  const res = await fetch(`${HERMES_ENDPOINT}/v1/runs/${runId}/events`, {
    method: "GET",
    headers: { ...headers(), Accept: "text/event-stream" },
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Hermes SSE failed: ${res.status}`);
  }

  yield* parseSSEStream(res.body, signal);
}

// ---------------------------------------------------------------------------
// Chat Completions API — session continuity, prompt cache reuse
// Used for: plan→draft→critique→revise (sequential, share session)
// ---------------------------------------------------------------------------
export async function hermesChatStream(opts: {
  message: string;
  messages?: { role: string; content: string }[];
  sessionId?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<{
  content: string;
  sessionId: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  events: AsyncGenerator<TaskEvent>;
}> {
  const h = headers();
  if (opts.sessionId) {
    h["X-Hermes-Session-Id"] = opts.sessionId;
  }

  const body: Record<string, unknown> = {
    messages: opts.messages ?? [{ role: "user", content: opts.message }],
    stream: true,
  };
  if (opts.model) body.model = opts.model;

  const res = await fetch(`${HERMES_ENDPOINT}/v1/chat/completions`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(`Hermes chat failed: ${res.status} ${await res.text()}`);
  }

  const returnedSessionId =
    res.headers.get("X-Hermes-Session-Id") ?? opts.sessionId ?? "";

  // For streaming chat completions, we need to collect the full response
  // while also yielding events.
  let fullContent = "";
  let usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined;

  async function* eventGenerator(): AsyncGenerator<TaskEvent> {
    if (!res.body) return;

    for await (const event of parseSSEStream(res.body, opts.signal)) {
      // Chat completions streaming uses OpenAI format:
      // data: {"choices":[{"delta":{"content":"text"}}]}
      // Plus hermes custom: event: hermes.tool.progress
      if (event.event === "hermes.tool.progress") {
        // hermes.tool.progress payload: { tool, emoji, label }
        const data = event as unknown as Record<string, unknown>;
        const emoji = data.emoji ? String(data.emoji) + " " : "";
        const label = data.label ? String(data.label) : String(data.tool ?? "");
        yield {
          event: "tool.started",
          timestamp: Date.now() / 1000,
          tool: String(data.tool ?? ""),
          preview: `${emoji}${label}`,
        };
      } else if (event.delta) {
        fullContent += event.delta;
        yield {
          event: "message.delta",
          timestamp: Date.now() / 1000,
          delta: event.delta,
        };
      } else if (event.usage) {
        usage = event.usage as typeof usage;
      }
    }
  }

  // We return the generator; the caller iterates it to get events + final content.
  // fullContent and usage are populated as the generator is consumed.
  const events = eventGenerator();

  return {
    get content() { return fullContent; },
    sessionId: returnedSessionId,
    get usage() { return usage; },
    events,
  };
}

// Non-streaming variant for quick calls (plan phase)
export async function hermesChat(opts: {
  message: string;
  sessionId?: string;
  model?: string;
}): Promise<{
  content: string;
  sessionId: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}> {
  const h = headers();
  if (opts.sessionId) {
    h["X-Hermes-Session-Id"] = opts.sessionId;
  }

  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: opts.message }],
    stream: false,
  };
  if (opts.model) body.model = opts.model;
  const res = await fetch(`${HERMES_ENDPOINT}/v1/chat/completions`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Hermes chat failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const sessionId =
    res.headers.get("X-Hermes-Session-Id") ?? opts.sessionId ?? "";
  const content = data.choices?.[0]?.message?.content ?? "";
  const u = data.usage;
  const usage = u
    ? {
        input_tokens: u.prompt_tokens,
        output_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
      }
    : undefined;

  return { content, sessionId, usage };
}

// ---------------------------------------------------------------------------
// SSE stream parser — shared between runs and chat completions
// ---------------------------------------------------------------------------
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<TaskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let dataLines: string[] = [];

  function buildEvent(): TaskEvent | null {
    if (dataLines.length === 0) return null;
    const data = dataLines.join("\n");
    dataLines = [];
    const name = currentEvent;
    currentEvent = "message";

    if (data === "[DONE]") return null;

    try {
      const parsed = JSON.parse(data);
      // OpenAI streaming format
      if (parsed.choices?.[0]?.delta?.content !== undefined) {
        return {
          event: "message.delta",
          timestamp: Date.now() / 1000,
          delta: parsed.choices[0].delta.content,
        };
      }
      if (parsed.choices?.[0]?.finish_reason) {
        return {
          event: "run.completed",
          timestamp: Date.now() / 1000,
          usage: parsed.usage,
        };
      }
      return { event: name, ...parsed };
    } catch {
      return {
        event: name,
        timestamp: Date.now() / 1000,
        delta: data,
      };
    }
  }

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);

        if (line === "") {
          const evt = buildEvent();
          if (evt) yield evt;
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    const evt = buildEvent();
    if (evt) yield evt;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}
