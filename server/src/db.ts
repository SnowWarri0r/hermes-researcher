import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type {
  Task,
  TaskDetail,
  TaskEvent,
  TaskStatus,
  TaskMode,
  Turn,
  TurnDetail,
  TurnStatus,
  Phase,
  PhaseDetail,
  PhaseKind,
  PhaseStatus,
  PipelineProgress,
} from "../../shared/types.ts";

const DB_DIR = join(homedir(), ".hermes-dashboard");
mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = process.env.HERMES_DASHBOARD_DB || join(DB_DIR, "tasks.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    goal        TEXT NOT NULL,
    context     TEXT NOT NULL DEFAULT '',
    toolsets    TEXT NOT NULL DEFAULT '[]',
    mode        TEXT NOT NULL DEFAULT 'deep',
    language    TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

  CREATE TABLE IF NOT EXISTS turns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL,
    seq           INTEGER NOT NULL,
    user_message  TEXT NOT NULL,
    report        TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL,
    error         TEXT,
    created_at    INTEGER NOT NULL,
    completed_at  INTEGER,
    usage         TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_turns_task ON turns(task_id, seq);
  CREATE INDEX IF NOT EXISTS idx_turns_status ON turns(status);

  CREATE TABLE IF NOT EXISTS phases (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id       INTEGER NOT NULL,
    seq           INTEGER NOT NULL,
    branch        INTEGER NOT NULL DEFAULT 0,
    kind          TEXT NOT NULL,
    label         TEXT NOT NULL DEFAULT '',
    run_id        TEXT UNIQUE,
    output        TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL,
    error         TEXT,
    created_at    INTEGER NOT NULL,
    completed_at  INTEGER,
    usage         TEXT,
    FOREIGN KEY (turn_id) REFERENCES turns(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_phases_turn ON phases(turn_id, seq, branch);
  CREATE INDEX IF NOT EXISTS idx_phases_runid ON phases(run_id);
  CREATE INDEX IF NOT EXISTS idx_phases_status ON phases(status);

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phase_id   INTEGER NOT NULL,
    seq        INTEGER NOT NULL,
    event      TEXT NOT NULL,
    data       TEXT NOT NULL,
    timestamp  REAL NOT NULL,
    FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_events_phase ON events(phase_id, seq);
`);

// -----------------------------------------------------------------------------
// Row types & mappers
// -----------------------------------------------------------------------------
interface TaskRow {
  id: string;
  goal: string;
  context: string;
  toolsets: string;
  mode: string;
  language: string;
  tags: string;
  pinned: number;
  created_at: number;
}

interface TurnRow {
  id: number;
  task_id: string;
  seq: number;
  user_message: string;
  report: string;
  status: string;
  error: string | null;
  created_at: number;
  completed_at: number | null;
  usage: string | null;
}

interface PhaseRow {
  id: number;
  turn_id: number;
  seq: number;
  branch: number;
  kind: string;
  label: string;
  run_id: string | null;
  output: string;
  status: string;
  error: string | null;
  created_at: number;
  completed_at: number | null;
  usage: string | null;
  tool_count: number;
}

function rowToPhase(r: PhaseRow): Phase {
  return {
    id: r.id,
    turnId: r.turn_id,
    seq: r.seq,
    branch: r.branch,
    kind: r.kind as PhaseKind,
    label: r.label,
    runId: r.run_id,
    output: r.output,
    status: r.status as PhaseStatus,
    error: r.error ?? undefined,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
    usage: r.usage ? JSON.parse(r.usage) : undefined,
    toolCount: r.tool_count ?? 0,
  };
}

function rowToTurn(r: TurnRow, phaseCount: number): Turn {
  return {
    id: r.id,
    seq: r.seq,
    userMessage: r.user_message,
    report: r.report,
    status: r.status as TurnStatus,
    error: r.error ?? undefined,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
    usage: r.usage ? JSON.parse(r.usage) : undefined,
    phaseCount,
  };
}

const selectPhaseSummaryForLatestTurn = db.prepare(`
  SELECT p.kind, p.label, p.status
  FROM phases p
  JOIN turns t ON t.id = p.turn_id
  WHERE t.task_id = ?
    AND t.seq = (SELECT MAX(t2.seq) FROM turns t2 WHERE t2.task_id = ?)
  ORDER BY p.seq ASC, p.branch ASC
`);

function getProgress(taskId: string): PipelineProgress | undefined {
  const rows = selectPhaseSummaryForLatestTurn.all(taskId, taskId) as {
    kind: string;
    label: string;
    status: string;
  }[];
  if (rows.length === 0) return undefined;

  const total = rows.length;
  const done = rows.filter((r) => r.status === "completed").length;
  const running = rows.find((r) => r.status === "running");
  const current = running?.label ?? rows.find((r) => r.status === "pending")?.label ?? "";

  if (done === total) return undefined; // no progress needed when done
  return { current, done, total };
}

function composeTask(task: TaskRow, latest?: Turn, turnCount = 0): Task {
  const progress = latest?.status === "running" ? getProgress(task.id) : undefined;
  return {
    id: task.id,
    goal: task.goal,
    context: task.context,
    toolsets: JSON.parse(task.toolsets),
    mode: (task.mode as TaskMode) || "deep",
    language: task.language || "",
    tags: JSON.parse(task.tags || "[]"),
    pinned: Boolean(task.pinned),
    createdAt: task.created_at,
    status: (latest?.status as TaskStatus) ?? "running",
    result: latest?.report ?? "",
    error: latest?.error,
    completedAt: latest?.completedAt,
    usage: latest?.usage,
    turnCount,
    progress,
  };
}

// -----------------------------------------------------------------------------
// Prepared statements
// -----------------------------------------------------------------------------
const stmts = {
  insertTask: db.prepare(
    `INSERT INTO tasks (id, goal, context, toolsets, mode, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  selectTask: db.prepare(`SELECT * FROM tasks WHERE id = ?`),
  listTasks: db.prepare(
    `SELECT * FROM tasks ORDER BY pinned DESC, created_at DESC LIMIT ? OFFSET ?`
  ),
  searchTasks: db.prepare(
    `SELECT * FROM tasks WHERE goal LIKE ? ORDER BY pinned DESC, created_at DESC LIMIT ? OFFSET ?`
  ),
  countSearchTasks: db.prepare(
    `SELECT COUNT(*) AS c FROM tasks WHERE goal LIKE ?`
  ),
  updateTags: db.prepare(`UPDATE tasks SET tags = ? WHERE id = ?`),
  updatePinned: db.prepare(`UPDATE tasks SET pinned = ? WHERE id = ?`),
  countTasks: db.prepare(`SELECT COUNT(*) AS c FROM tasks`),
  deleteTask: db.prepare(`DELETE FROM tasks WHERE id = ?`),

  insertTurn: db.prepare(`
    INSERT INTO turns (task_id, seq, user_message, status, created_at)
    VALUES (?, ?, ?, 'running', ?)
  `),
  selectTurnById: db.prepare(`SELECT * FROM turns WHERE id = ?`),
  selectTurnsForTask: db.prepare(
    `SELECT * FROM turns WHERE task_id = ? ORDER BY seq ASC`
  ),
  selectLatestTurn: db.prepare(
    `SELECT * FROM turns WHERE task_id = ? ORDER BY seq DESC LIMIT 1`
  ),
  countTurns: db.prepare(
    `SELECT COUNT(*) AS c FROM turns WHERE task_id = ?`
  ),
  maxTurnSeq: db.prepare(
    `SELECT COALESCE(MAX(seq), -1) AS s FROM turns WHERE task_id = ?`
  ),
  completeTurn: db.prepare(`
    UPDATE turns
    SET status = ?, report = ?, completed_at = ?, usage = ?, error = ?
    WHERE id = ?
  `),

  insertPhase: db.prepare(`
    INSERT INTO phases (turn_id, seq, branch, kind, label, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `),
  selectPhaseById: db.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM events e WHERE e.phase_id = p.id AND e.event = 'tool.completed') AS tool_count
     FROM phases p WHERE p.id = ?`
  ),
  selectPhaseByRunId: db.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM events e WHERE e.phase_id = p.id AND e.event = 'tool.completed') AS tool_count
     FROM phases p WHERE p.run_id = ?`
  ),
  selectPhasesForTurn: db.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM events e WHERE e.phase_id = p.id AND e.event = 'tool.completed') AS tool_count
     FROM phases p WHERE p.turn_id = ? ORDER BY p.seq ASC, p.branch ASC`
  ),
  updatePhaseRunning: db.prepare(`
    UPDATE phases SET status = 'running', run_id = ? WHERE id = ?
  `),
  completePhase: db.prepare(`
    UPDATE phases
    SET status = ?, output = ?, completed_at = ?, usage = ?, error = ?
    WHERE id = ?
  `),
  listEventsForPhase: db.prepare(
    `SELECT event, data, timestamp FROM events WHERE phase_id = ? ORDER BY seq ASC`
  ),
  insertEvent: db.prepare(
    `INSERT INTO events (phase_id, seq, event, data, timestamp) VALUES (?, ?, ?, ?, ?)`
  ),
  maxEventSeq: db.prepare(
    `SELECT COALESCE(MAX(seq), -1) AS s FROM events WHERE phase_id = ?`
  ),
  selectRunningPhases: db.prepare(
    `SELECT run_id FROM phases WHERE status = 'running' AND run_id IS NOT NULL`
  ),
};

// -----------------------------------------------------------------------------
// Public store
// -----------------------------------------------------------------------------
export const store = {
  createTask(opts: {
    id: string;
    goal: string;
    context: string;
    toolsets: string[];
    mode: TaskMode;
    language: string;
    createdAt: number;
  }) {
    stmts.insertTask.run(
      opts.id,
      opts.goal,
      opts.context,
      JSON.stringify(opts.toolsets),
      opts.mode,
      opts.language,
      opts.createdAt
    );
  },

  addTurn(opts: {
    taskId: string;
    userMessage: string;
    createdAt: number;
  }): { id: number; seq: number } {
    const seq = (stmts.maxTurnSeq.get(opts.taskId) as { s: number }).s + 1;
    const info = stmts.insertTurn.run(
      opts.taskId,
      seq,
      opts.userMessage,
      opts.createdAt
    );
    return { id: Number(info.lastInsertRowid), seq };
  },

  addPhase(opts: {
    turnId: number;
    seq: number;
    branch: number;
    kind: PhaseKind;
    label: string;
    createdAt: number;
  }): Phase {
    const info = stmts.insertPhase.run(
      opts.turnId,
      opts.seq,
      opts.branch,
      opts.kind,
      opts.label,
      opts.createdAt
    );
    const id = Number(info.lastInsertRowid);
    const row = stmts.selectPhaseById.get(id) as PhaseRow;
    return rowToPhase(row);
  },

  markPhaseRunning(phaseId: number, runId: string) {
    stmts.updatePhaseRunning.run(runId, phaseId);
  },

  completePhase(opts: {
    phaseId: number;
    status: "completed" | "failed" | "skipped";
    output: string;
    completedAt: number;
    usage?: object;
    error?: string;
  }) {
    stmts.completePhase.run(
      opts.status,
      opts.output,
      opts.completedAt,
      opts.usage ? JSON.stringify(opts.usage) : null,
      opts.error ?? null,
      opts.phaseId
    );
  },

  completeTurn(opts: {
    turnId: number;
    status: "completed" | "failed";
    report: string;
    completedAt: number;
    usage?: object;
    error?: string;
  }) {
    stmts.completeTurn.run(
      opts.status,
      opts.report,
      opts.completedAt,
      opts.usage ? JSON.stringify(opts.usage) : null,
      opts.error ?? null,
      opts.turnId
    );
  },

  appendEvent(runId: string, event: TaskEvent) {
    const row = stmts.selectPhaseByRunId.get(runId) as PhaseRow | undefined;
    if (!row) return;
    const seq = (stmts.maxEventSeq.get(row.id) as { s: number }).s + 1;
    const { event: name, timestamp, ...rest } = event;
    stmts.insertEvent.run(
      row.id,
      seq,
      name,
      JSON.stringify(rest),
      timestamp ?? Date.now() / 1000
    );
  },

  getTask(id: string): TaskDetail | null {
    const row = stmts.selectTask.get(id) as TaskRow | undefined;
    if (!row) return null;
    const turnRows = stmts.selectTurnsForTask.all(id) as TurnRow[];
    const turns: TurnDetail[] = turnRows.map((t) => {
      const phaseRows = stmts.selectPhasesForTurn.all(t.id) as PhaseRow[];
      const phases: PhaseDetail[] = phaseRows.map((p) => {
        const phase = rowToPhase(p);
        const evs = stmts.listEventsForPhase.all(p.id) as {
          event: string;
          data: string;
          timestamp: number;
        }[];
        const events: TaskEvent[] = evs.map((e) => ({
          event: e.event,
          timestamp: e.timestamp,
          ...JSON.parse(e.data),
        }));
        return { ...phase, events };
      });
      return { ...rowToTurn(t, phases.length), phases };
    });
    const latest = turns[turns.length - 1];
    return { ...composeTask(row, latest, turns.length), turns };
  },

  listTasks(opts: { limit: number; offset: number; q?: string; status?: string }): {
    tasks: Task[];
    total: number;
  } {
    let taskRows: TaskRow[];
    let total: number;

    if (opts.q) {
      const pattern = `%${opts.q}%`;
      taskRows = stmts.searchTasks.all(pattern, opts.limit, opts.offset) as TaskRow[];
      total = (stmts.countSearchTasks.get(pattern) as { c: number }).c;
    } else {
      taskRows = stmts.listTasks.all(opts.limit, opts.offset) as TaskRow[];
      total = (stmts.countTasks.get() as { c: number }).c;
    }

    const rows = taskRows;
    const tasks = rows.map((r) => {
      const latestRow = stmts.selectLatestTurn.get(r.id) as TurnRow | undefined;
      const count = (stmts.countTurns.get(r.id) as { c: number }).c;
      let latest: Turn | undefined;
      if (latestRow) {
        const phaseRows = stmts.selectPhasesForTurn.all(
          latestRow.id
        ) as PhaseRow[];
        latest = rowToTurn(latestRow, phaseRows.length);
      }
      return composeTask(r, latest, count);
    });
    // Post-filter by status if requested (status is derived, not in tasks table)
    if (opts.status) {
      const filtered = tasks.filter((t) => t.status === opts.status);
      return { tasks: filtered, total: filtered.length };
    }

    return { tasks, total };
  },

  getPhaseByRunId(runId: string): Phase | null {
    const row = stmts.selectPhaseByRunId.get(runId) as PhaseRow | undefined;
    if (!row) return null;
    return rowToPhase(row);
  },

  getTurnHistory(
    taskId: string
  ): { userMessage: string; report: string; status: string }[] {
    const rows = stmts.selectTurnsForTask.all(taskId) as TurnRow[];
    return rows.map((r) => ({
      userMessage: r.user_message,
      report: r.report,
      status: r.status,
    }));
  },

  setTags(id: string, tags: string[]) {
    stmts.updateTags.run(JSON.stringify(tags), id);
  },

  setPinned(id: string, pinned: boolean) {
    stmts.updatePinned.run(pinned ? 1 : 0, id);
  },

  deleteTask(id: string) {
    stmts.deleteTask.run(id);
  },

  getRunningRunIds(): string[] {
    const rows = stmts.selectRunningPhases.all() as { run_id: string }[];
    return rows.map((r) => r.run_id);
  },
};
