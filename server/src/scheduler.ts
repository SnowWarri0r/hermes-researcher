/**
 * Cron-based task scheduler — runs tasks from templates on a schedule.
 * Supports date variables in goal/context text.
 */

import cron from "node-cron";
import crypto from "node:crypto";
import { db, store } from "./db.ts";
import { runPipeline } from "./runner.ts";
import { sendToDiscord } from "./discord.ts";
import type { TaskMode } from "../../shared/types.ts";

export interface Schedule {
  id: string;
  name: string;
  goal: string;
  context: string;
  mode: TaskMode;
  language: string;
  toolsets: string[];
  cron: string;
  discordWebhook: string;
  enabled: boolean;
  lastRunAt?: number;
  lastTaskId?: string;
  createdAt: number;
}

interface ScheduleRow {
  id: string;
  name: string;
  goal: string;
  context: string;
  mode: string;
  language: string;
  toolsets: string;
  cron: string;
  discord_webhook: string;
  enabled: number;
  last_run_at: number | null;
  last_task_id: string | null;
  created_at: number;
}

function rowToSchedule(r: ScheduleRow): Schedule {
  return {
    id: r.id,
    name: r.name,
    goal: r.goal,
    context: r.context,
    mode: r.mode as TaskMode,
    language: r.language,
    toolsets: JSON.parse(r.toolsets),
    cron: r.cron,
    discordWebhook: r.discord_webhook,
    enabled: r.enabled === 1,
    lastRunAt: r.last_run_at ?? undefined,
    lastTaskId: r.last_task_id ?? undefined,
    createdAt: r.created_at,
  };
}

// ── Date variable substitution ──
function substituteDateVars(text: string): string {
  const now = new Date();
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; // local YYYY-MM-DD
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return text
    .replace(/\{date\}/g, fmt(now))
    .replace(/\{today\}/g, fmt(now))
    .replace(/\{yesterday\}/g, fmt(yesterday))
    .replace(/\{weekStart\}/g, fmt(weekStart))
    .replace(/\{weekEnd\}/g, fmt(weekEnd))
    .replace(/\{monthStart\}/g, fmt(monthStart))
    .replace(/\{monthEnd\}/g, fmt(monthEnd))
    .replace(/\{year\}/g, String(now.getFullYear()))
    .replace(/\{month\}/g, String(now.getMonth() + 1).padStart(2, "0"));
}

// ── CRUD ──
const stmts = {
  list: db.prepare(`SELECT * FROM schedules ORDER BY created_at DESC`),
  get: db.prepare(`SELECT * FROM schedules WHERE id = ?`),
  insert: db.prepare(`INSERT INTO schedules (id, name, goal, context, mode, language, toolsets, cron, discord_webhook, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  update: db.prepare(`UPDATE schedules SET name=?, goal=?, context=?, mode=?, language=?, toolsets=?, cron=?, discord_webhook=?, enabled=? WHERE id=?`),
  delete: db.prepare(`DELETE FROM schedules WHERE id = ?`),
  markRun: db.prepare(`UPDATE schedules SET last_run_at = ?, last_task_id = ? WHERE id = ?`),
};

export function listSchedules(): Schedule[] {
  return (stmts.list.all() as ScheduleRow[]).map(rowToSchedule);
}

export function getSchedule(id: string): Schedule | null {
  const row = stmts.get.get(id) as ScheduleRow | undefined;
  return row ? rowToSchedule(row) : null;
}

export function createSchedule(opts: Omit<Schedule, "id" | "createdAt" | "lastRunAt" | "lastTaskId">): Schedule {
  const id = `sched_${crypto.randomUUID().replace(/-/g, "")}`;
  stmts.insert.run(id, opts.name, opts.goal, opts.context, opts.mode, opts.language, JSON.stringify(opts.toolsets), opts.cron, opts.discordWebhook, opts.enabled ? 1 : 0, Date.now());
  return getSchedule(id)!;
}

export function updateSchedule(id: string, opts: Partial<Omit<Schedule, "id" | "createdAt" | "lastRunAt" | "lastTaskId">>): Schedule | null {
  const existing = getSchedule(id);
  if (!existing) return null;
  const merged = { ...existing, ...opts };
  stmts.update.run(merged.name, merged.goal, merged.context, merged.mode, merged.language, JSON.stringify(merged.toolsets), merged.cron, merged.discordWebhook, merged.enabled ? 1 : 0, id);
  reloadJobs(); // re-schedule
  return getSchedule(id);
}

export function deleteSchedule(id: string): void {
  stmts.delete.run(id);
  reloadJobs();
}

// ── Execution ──
async function executeSchedule(schedule: Schedule): Promise<void> {
  const goal = substituteDateVars(schedule.goal);
  const context = substituteDateVars(schedule.context);

  const taskId = `task_${crypto.randomUUID().replace(/-/g, "")}`;
  const createdAt = Date.now();

  store.createTask({
    id: taskId,
    goal,
    context,
    toolsets: schedule.toolsets,
    mode: schedule.mode,
    language: schedule.language,
    createdAt,
  });

  const turn = store.addTurn({ taskId, userMessage: goal, createdAt });
  stmts.markRun.run(createdAt, taskId, schedule.id);

  console.log(`[scheduler] Running "${schedule.name}" → ${taskId}`);

  try {
    await runPipeline({
      taskId,
      turnId: turn.id,
      goal,
      context,
      toolsets: schedule.toolsets,
      mode: schedule.mode,
      language: schedule.language || undefined,
    });

    // Deliver to Discord if configured
    if (schedule.discordWebhook) {
      const task = store.getTask(taskId);
      if (task?.result) {
        await sendToDiscord({
          webhookUrl: schedule.discordWebhook,
          goal,
          report: task.result,
          mode: schedule.mode,
          duration: task.completedAt && task.createdAt ? (task.completedAt - task.createdAt) / 1000 : undefined,
          tokens: task.usage?.total_tokens,
        });
      }
    }
  } catch (e) {
    console.error(`[scheduler] "${schedule.name}" failed:`, e);
  }
}

// ── Cron job management ──
const activeJobs = new Map<string, ReturnType<typeof cron.schedule>>();

function reloadJobs(): void {
  // Stop all existing jobs
  for (const [, job] of activeJobs) job.stop();
  activeJobs.clear();

  // Schedule enabled ones
  for (const schedule of listSchedules()) {
    if (!schedule.enabled) continue;
    if (!cron.validate(schedule.cron)) {
      console.warn(`[scheduler] Invalid cron "${schedule.cron}" for "${schedule.name}"`);
      continue;
    }

    const job = cron.schedule(schedule.cron, () => {
      // Re-fetch in case it was updated/disabled
      const current = getSchedule(schedule.id);
      if (!current || !current.enabled) return;
      executeSchedule(current).catch((e) => console.error(`[scheduler] error:`, e));
    });
    activeJobs.set(schedule.id, job);
  }

  console.log(`[scheduler] ${activeJobs.size} active job(s)`);
}

/** Manually trigger a schedule now (for testing). */
export async function triggerSchedule(id: string): Promise<string | null> {
  const schedule = getSchedule(id);
  if (!schedule) return null;
  await executeSchedule(schedule);
  return schedule.lastTaskId ?? null;
}

/** Initialize scheduler on startup. */
export function startScheduler(): void {
  reloadJobs();
}
