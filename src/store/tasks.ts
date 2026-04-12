import { create } from "zustand";
import type { Task, TaskDetail, TaskMode } from "../types";
import {
  createTask as apiCreate,
  deleteTask as apiDelete,
  getTask as apiGet,
  listTasks as apiList,
  sendFollowup as apiFollowup,
  subscribeToTask,
  cancelTask as apiCancel,
  patchTask as apiPatch,
} from "../api/client";
import { sendNotification } from "../hooks/useNotification";

interface TaskStore {
  tasks: Task[];
  total: number;
  loading: boolean;
  connected: boolean;
  searchQuery: string;
  filterStatus: string;
  activeTaskId: string | null;
  activeTaskDetail: TaskDetail | null;
  activeTaskError: string | null;
  streamingText: string;
  streamingPhaseKind: string;
  activeUnsub: (() => void) | null;

  setConnected: (c: boolean) => void;
  setSearch: (q: string) => void;
  setFilterStatus: (status: string) => void;

  refreshList: () => Promise<void>;
  refreshActive: () => Promise<void>;

  dispatch: (goal: string, context: string, toolsets: string[], mode: TaskMode, language?: string) => Promise<void>;
  followup: (id: string, message: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;

  togglePin: (id: string) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  openTask: (id: string) => Promise<void>;
  closeTask: () => void;
  removeTask: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
}

export const useTaskStore = create<TaskStore>()((set, get) => ({
  tasks: [],
  total: 0,
  loading: false,
  connected: false,
  searchQuery: "",
  filterStatus: "",
  activeTaskId: null,
  activeTaskDetail: null,
  activeTaskError: null,
  streamingText: "",
  streamingPhaseKind: "",
  activeUnsub: null,

  setConnected(connected) {
    set({ connected });
  },

  setSearch(q) {
    set({ searchQuery: q });
    get().refreshList();
  },

  setFilterStatus(status) {
    set({ filterStatus: status });
    get().refreshList();
  },

  async refreshList() {
    set({ loading: true });
    try {
      const { searchQuery, filterStatus } = get();
      const { tasks, total } = await apiList({
        limit: 100,
        q: searchQuery || undefined,
        status: filterStatus || undefined,
      });
      set({ tasks, total, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  async refreshActive() {
    const id = get().activeTaskId;
    if (!id) return;
    try {
      const detail = await apiGet(id);
      if (get().activeTaskId === id) {
        set({ activeTaskDetail: detail, streamingText: "" });
      }
    } catch {
      /* ignore */
    }
  },

  async dispatch(goal, context, toolsets, mode, language) {
    await apiCreate({ goal, context, toolsets, mode, language: language || undefined });
    await get().refreshList();
  },

  async followup(id, message) {
    await apiFollowup(id, { message });
    // Re-open task to pick up new turn + start SSE
    await get().openTask(id);
    await get().refreshList();
  },

  async retry(id) {
    const task = get().activeTaskDetail ?? get().tasks.find((t) => t.id === id);
    if (!task) return;
    await apiCreate({
      goal: task.goal,
      context: task.context,
      toolsets: task.toolsets,
      mode: task.mode,
    });
    await get().refreshList();
  },

  async cancel(id) {
    await apiCancel(id);
    await get().refreshActive();
    await get().refreshList();
  },

  async togglePin(id) {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    await apiPatch(id, { pinned: !task.pinned });
    await get().refreshList();
    if (get().activeTaskId === id) get().refreshActive();
  },

  async setTags(id, tags) {
    await apiPatch(id, { tags });
    await get().refreshList();
    if (get().activeTaskId === id) get().refreshActive();
  },

  async openTask(id) {
    // Cleanup previous SSE
    get().activeUnsub?.();
    set({
      activeTaskId: id,
      activeTaskDetail: null,
      activeTaskError: null,
      streamingText: "",
      streamingPhaseKind: "",
      activeUnsub: null,
    });

    try {
      const detail = await apiGet(id);
      if (get().activeTaskId !== id) return;
      set({ activeTaskDetail: detail });

      // If running, subscribe to SSE for live updates
      if (detail.status === "running") {
        const unsub = subscribeToTask(
          id,
          (event) => {
            if (get().activeTaskId !== id) return;

            if (event.event === "phase.started") {
              const data = event as unknown as Record<string, unknown>;
              set({ streamingText: "", streamingPhaseKind: String(data.kind ?? "") });
              get().refreshActive();
            }

            if (event.event === "message.delta" && event.delta) {
              // Only accumulate streaming text for report-producing phases
              const kind = get().streamingPhaseKind;
              const reportPhases = ["write", "draft", "revise"];
              if (reportPhases.includes(kind)) {
                set((s) => ({ streamingText: s.streamingText + event.delta }));
              }
            }

            if (
              event.event === "phase.completed" ||
              event.event === "phase.failed"
            ) {
              set({ streamingText: "" });
              get().refreshActive();
            }

            if (event.event === "pipeline.completed") {
              set({ streamingText: "" });
              get().refreshActive();
              get().refreshList();
              const task = get().activeTaskDetail;
              sendNotification(
                "Task completed",
                task?.goal.slice(0, 80) ?? "Research finished"
              );
            }

            if (event.event === "pipeline.failed") {
              set({ streamingText: "" });
              get().refreshActive();
              get().refreshList();
              sendNotification("Task failed", "A research task encountered an error");
            }
          },
          () => {},
          () => {}
        );
        set({ activeUnsub: unsub });
      }
    } catch (e) {
      if (get().activeTaskId === id) {
        set({ activeTaskError: e instanceof Error ? e.message : String(e) });
        get().refreshList();
      }
    }
  },

  closeTask() {
    get().activeUnsub?.();
    set({
      activeTaskId: null,
      activeTaskDetail: null,
      activeTaskError: null,
      streamingText: "",
      streamingPhaseKind: "",
      activeUnsub: null,
    });
  },

  async removeTask(id) {
    await apiDelete(id);
    if (get().activeTaskId === id) get().closeTask();
    await get().refreshList();
  },

  async clearCompleted() {
    const toRemove = get().tasks.filter(
      (t) => t.status === "completed" || t.status === "failed"
    );
    await Promise.all(toRemove.map((t) => apiDelete(t.id)));
    await get().refreshList();
  },
}));

// Global poll: refresh list when there are running tasks
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    const state = useTaskStore.getState();
    const listHasInFlight = state.tasks.some((t) => t.status === "running");
    if (listHasInFlight) state.refreshList();
  }, 3000);
}
