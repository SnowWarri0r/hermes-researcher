import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { store } from "./db.ts";
import { hermesHealth } from "./hermes.ts";
import {
  runPipeline,
  subscribe,
  cancelTaskPhases,
  resumeTracking,
} from "./runner.ts";
import type {
  CreateTaskRequest,
  FollowupRequest,
} from "../../shared/types.ts";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE"],
    credentials: true,
  })
);

app.get("/api/health", async (c) => {
  const hermesOk = await hermesHealth();
  return c.json({ status: "ok", hermes: hermesOk });
});

app.get("/api/tasks", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const q = c.req.query("q")?.trim() || undefined;
  const status = c.req.query("status")?.trim() || undefined;
  return c.json(store.listTasks({ limit, offset, q, status }));
});

app.get("/api/tasks/:id", (c) => {
  const id = c.req.param("id");
  const task = store.getTask(id);
  if (!task) return c.json({ error: "not found" }, 404);
  return c.json(task);
});

app.post("/api/tasks", async (c) => {
  const body = (await c.req.json()) as CreateTaskRequest;
  if (!body.goal?.trim()) {
    return c.json({ error: "goal is required" }, 400);
  }

  const goal = body.goal.trim();
  const context = (body.context ?? "").trim();
  const toolsets = body.toolsets ?? [];
  const mode = body.mode ?? "deep";
  const language = (body.language ?? "").trim();

  const taskId = `task_${randomUUID().replace(/-/g, "")}`;
  const createdAt = Date.now();

  store.createTask({ id: taskId, goal, context, toolsets, mode, language, createdAt });
  const turn = store.addTurn({
    taskId,
    userMessage: goal,
    createdAt,
  });

  runPipeline({
    taskId,
    turnId: turn.id,
    goal,
    context,
    toolsets,
    mode,
    language: language || undefined,
  }).catch(() => {
    /* errors already persisted & broadcast */
  });

  return c.json(store.getTask(taskId), 201);
});

app.post("/api/tasks/:id/followup", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as FollowupRequest;
  if (!body.message?.trim()) {
    return c.json({ error: "message is required" }, 400);
  }

  const task = store.getTask(id);
  if (!task) return c.json({ error: "not found" }, 404);
  if (task.status === "running") {
    return c.json({ error: "previous turn still running" }, 409);
  }

  const followupMessage = body.message.trim();
  const priorReport = task.result || "(No prior report produced yet.)";
  const createdAt = Date.now();

  const turn = store.addTurn({
    taskId: id,
    userMessage: followupMessage,
    createdAt,
  });

  runPipeline({
    taskId: id,
    turnId: turn.id,
    goal: task.goal,
    context: task.context,
    toolsets: task.toolsets,
    mode: task.mode,
    language: task.language || undefined,
    priorReport,
    followupMessage,
  }).catch(() => {
    /* persisted */
  });

  return c.json(store.getTask(id), 201);
});

app.patch("/api/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as {
    tags?: string[];
    pinned?: boolean;
  };
  const task = store.getTask(id);
  if (!task) return c.json({ error: "not found" }, 404);

  if (body.tags !== undefined) store.setTags(id, body.tags);
  if (body.pinned !== undefined) store.setPinned(id, body.pinned);

  return c.json(store.getTask(id));
});

app.post("/api/tasks/:id/cancel", (c) => {
  const id = c.req.param("id");
  cancelTaskPhases(id);
  return c.json({ ok: true });
});

app.delete("/api/tasks/:id", (c) => {
  const id = c.req.param("id");
  cancelTaskPhases(id);
  store.deleteTask(id);
  return c.json({ ok: true });
});

app.get("/api/tasks/:id/stream", (c) => {
  const id = c.req.param("id");
  const task = store.getTask(id);
  if (!task) return c.json({ error: "not found" }, 404);

  return streamSSE(c, async (stream) => {
    // Initial snapshot
    await stream.writeSSE({
      event: "snapshot",
      data: JSON.stringify({ task }),
    });

    const latest = task.turns[task.turns.length - 1];
    if (!latest || latest.status !== "running") {
      return;
    }

    // Live subscription
    const chan: { event: string; data: string }[] = [];
    let resolver: (() => void) | null = null;

    const unsubscribe = subscribe(id, (event) => {
      chan.push({ event: event.event, data: JSON.stringify(event.data) });
      resolver?.();
    });

    stream.onAbort(() => {
      unsubscribe();
      resolver?.();
    });

    try {
      while (!stream.aborted) {
        if (chan.length === 0) {
          await new Promise<void>((r) => {
            resolver = r;
          });
          resolver = null;
          if (stream.aborted) break;
        }
        while (chan.length > 0) {
          const msg = chan.shift()!;
          await stream.writeSSE(msg);
        }
      }
    } finally {
      unsubscribe();
    }
  });
});

// Serve frontend static files in production (when ../dist exists)
const distPath = resolve(import.meta.dirname, "../../dist");
if (existsSync(distPath)) {
  app.use("/*", serveStatic({ root: distPath }));
  // SPA fallback: serve index.html for non-API, non-file routes
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api")) return c.notFound();
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(resolve(distPath, "index.html"), "utf-8");
    return c.html(html);
  });
}

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

resumeTracking();

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(
    `hermes-dashboard-server listening on http://${HOST === "0.0.0.0" ? "<lan-ip>" : HOST}:${info.port}`
  );
});
