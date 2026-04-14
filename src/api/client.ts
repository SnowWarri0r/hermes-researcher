import type {
  Task,
  TaskDetail,
  TaskEvent,
  ListTasksResponse,
  CreateTaskRequest,
  FollowupRequest,
} from "../types";

const API_BASE = "/api";

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) return false;
    const data = (await res.json()) as { status: string; hermes: boolean };
    return data.hermes === true;
  } catch {
    return false;
  }
}

export async function listTasks(params?: {
  limit?: number;
  offset?: number;
  status?: string;
  q?: string;
}): Promise<ListTasksResponse> {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  if (params?.status) qs.set("status", params.status);
  if (params?.q) qs.set("q", params.q);
  const url = `${API_BASE}/tasks${qs.toString() ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listTasks failed: ${res.status}`);
  return res.json();
}

export async function getTask(id: string): Promise<TaskDetail> {
  const res = await fetch(`${API_BASE}/tasks/${id}`);
  if (!res.ok) throw new Error(`getTask failed: ${res.status}`);
  return res.json();
}

export async function createTask(req: CreateTaskRequest): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createTask failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function cancelTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${id}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(`cancel failed: ${res.status}`);
}

export async function sendFollowup(
  id: string,
  req: FollowupRequest
): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks/${id}/followup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`followup failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function patchTask(
  id: string,
  patch: { tags?: string[]; pinned?: boolean }
): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
}

export async function retryTask(id: string): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks/${id}/retry`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`retry failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteTask failed: ${res.status}`);
}

export function subscribeToTask(
  taskId: string,
  onEvent: (event: TaskEvent) => void,
  onError: (error: string) => void,
  onDone: () => void
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/stream`, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        onError(`stream failed: ${res.status}`);
        onDone();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";
      let dataLines: string[] = [];

      function flush() {
        if (dataLines.length === 0) return;
        const data = dataLines.join("\n");
        dataLines = [];
        try {
          const parsed = JSON.parse(data);
          onEvent({ event: currentEvent, ...parsed });
          if (currentEvent === "run.completed" || currentEvent === "run.failed") {
            controller.abort();
            onDone();
          }
        } catch {
          onEvent({ event: currentEvent, timestamp: Date.now() / 1000, delta: data });
        }
        currentEvent = "message";
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).replace(/\r$/, "");
          buffer = buffer.slice(idx + 1);

          if (line === "") {
            flush();
          } else if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
      }

      flush();
      onDone();
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        onError((e as Error).message || "stream error");
      }
      onDone();
    }
  })();

  return () => controller.abort();
}
