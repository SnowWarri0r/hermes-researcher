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

export async function startHermesRun(input: string): Promise<string> {
  const res = await fetch(`${HERMES_ENDPOINT}/v1/runs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ input, store: true }),
  });
  if (!res.ok) {
    throw new Error(`Hermes run failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { run_id: string };
  return data.run_id;
}

/**
 * Subscribe to a hermes run's SSE events. Returns an async iterator of events.
 */
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

  const reader = res.body.getReader();
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
    try {
      const parsed = JSON.parse(data);
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
    while (true) {
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
