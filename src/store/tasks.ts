import { create } from "zustand";
import type { Task, TaskDetail, TaskMode, ChatMessage } from "../types";
import {
  createTask as apiCreate,
  deleteTask as apiDelete,
  getTask as apiGet,
  listTasks as apiList,
  sendFollowup as apiFollowup,
  retryTask as apiRetry,
  subscribeToTask,
  cancelTask as apiCancel,
  patchTask as apiPatch,
  listChatMessages as apiListChat,
  sendChatMessage as apiSendChat,
  clearChatThread as apiClearChat,
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
  streamingByPhase: Record<number, string>;
  activeUnsub: (() => void) | null;

  chatMessages: ChatMessage[];
  streamingChatByMessage: Record<number, string>;

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

  sendChat: (message: string) => Promise<void>;
  clearChat: () => Promise<void>;
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
  streamingByPhase: {},
  activeUnsub: null,
  chatMessages: [],
  streamingChatByMessage: {},

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
        set({ activeTaskDetail: detail });
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
    await apiRetry(id);
    // Re-open task to pick up new turn + start SSE
    await get().openTask(id);
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
      streamingByPhase: {},
      chatMessages: [],
      streamingChatByMessage: {},
      activeUnsub: null,
    });

    try {
      const detail = await apiGet(id);
      if (get().activeTaskId !== id) return;
      set({ activeTaskDetail: detail });

      // Load chat thread (if any) — doesn't block rendering
      apiListChat(id)
        .then((messages) => {
          if (get().activeTaskId === id) set({ chatMessages: messages });
        })
        .catch(() => { /* ignore */ });

      // Always subscribe to SSE — needed for chat events even on completed tasks
      {
        // Seed pipeline streaming state ONLY if the task is running.
        if (detail.status === "running") {
          const latestTurn = detail.turns[detail.turns.length - 1];
          if (latestTurn) {
            const seedByPhase: Record<number, string> = {};
            let seedMainText = "";
            const reportPhases = ["write", "draft", "revise"];

            for (const phase of latestTurn.phases) {
              if (phase.status === "running" && phase.output) {
                seedByPhase[phase.id] = phase.output;
                if (reportPhases.includes(phase.kind)) {
                  seedMainText = phase.output;
                }
              }
            }

            const runningPhase = latestTurn.phases.find((p) => p.status === "running");
            set({
              streamingPhaseKind: runningPhase?.kind ?? "",
              streamingByPhase: seedByPhase,
              streamingText: seedMainText,
            });
          }
        }

        const unsub = subscribeToTask(
          id,
          (event) => {
            if (get().activeTaskId !== id) return;

            if (event.event === "phase.started") {
              const data = event as unknown as Record<string, unknown>;
              const kind = String(data.kind ?? "");
              const reportPhases = ["write", "draft", "revise"];
              // Reset main streaming text only when a NEW report-producing phase starts.
              // For research/plan/critique, keep the main report text (if any) intact.
              if (reportPhases.includes(kind)) {
                set({ streamingText: "", streamingPhaseKind: kind });
              } else {
                set({ streamingPhaseKind: kind });
              }
              get().refreshActive();
            }

            if (event.event === "message.delta" && event.delta) {
              const data = event as unknown as Record<string, unknown>;
              const phaseId = typeof data.phaseId === "number" ? data.phaseId : undefined;
              const kind = String(data.kind ?? get().streamingPhaseKind);
              const reportPhases = ["write", "draft", "revise"];

              // Always accumulate per-phase for PipelineView live display
              if (phaseId !== undefined) {
                set((s) => ({
                  streamingByPhase: {
                    ...s.streamingByPhase,
                    [phaseId]: (s.streamingByPhase[phaseId] || "") + event.delta,
                  },
                }));
              }
              // Main report area only tracks the final report-producing phase
              if (reportPhases.includes(kind)) {
                set((s) => ({ streamingText: s.streamingText + event.delta }));
              }
            }

            if (
              event.event === "phase.completed" ||
              event.event === "phase.failed"
            ) {
              const data = event as unknown as Record<string, unknown>;
              const phaseId = typeof data.phaseId === "number" ? data.phaseId : undefined;
              if (phaseId !== undefined) {
                set((s) => {
                  const next = { ...s.streamingByPhase };
                  delete next[phaseId];
                  return { streamingByPhase: next };
                });
              }
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

            // Chat events
            if (event.event === "chat.message.started") {
              const data = event as unknown as Record<string, unknown>;
              const messageId = typeof data.messageId === "number" ? data.messageId : undefined;
              if (messageId !== undefined) {
                set((s) => ({
                  streamingChatByMessage: { ...s.streamingChatByMessage, [messageId]: "" },
                }));
                apiListChat(id).then((messages) => {
                  if (get().activeTaskId === id) set({ chatMessages: messages });
                }).catch(() => {});
              }
            }

            if (event.event === "chat.delta") {
              const data = event as unknown as Record<string, unknown>;
              const messageId = typeof data.messageId === "number" ? data.messageId : undefined;
              const delta = typeof data.delta === "string" ? data.delta : "";
              if (messageId !== undefined && delta) {
                set((s) => ({
                  streamingChatByMessage: {
                    ...s.streamingChatByMessage,
                    [messageId]: (s.streamingChatByMessage[messageId] || "") + delta,
                  },
                }));
              }
            }

            if (event.event === "chat.message.completed" || event.event === "chat.message.failed") {
              const data = event as unknown as Record<string, unknown>;
              const messageId = typeof data.messageId === "number" ? data.messageId : undefined;
              if (messageId !== undefined) {
                set((s) => {
                  const next = { ...s.streamingChatByMessage };
                  delete next[messageId];
                  return { streamingChatByMessage: next };
                });
              }
              apiListChat(id).then((messages) => {
                if (get().activeTaskId === id) set({ chatMessages: messages });
              }).catch(() => {});
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
      streamingByPhase: {},
      chatMessages: [],
      streamingChatByMessage: {},
      activeUnsub: null,
    });
  },

  async sendChat(message) {
    const id = get().activeTaskId;
    if (!id) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    const userMsg = await apiSendChat(id, trimmed);
    if (get().activeTaskId === id) {
      set((s) => ({ chatMessages: [...s.chatMessages, userMsg] }));
    }
  },

  async clearChat() {
    const id = get().activeTaskId;
    if (!id) return;
    await apiClearChat(id);
    if (get().activeTaskId === id) {
      set({ chatMessages: [], streamingChatByMessage: {} });
    }
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

// Global poll: refresh list + active detail when tasks are running
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    const state = useTaskStore.getState();
    const listHasInFlight = state.tasks.some((t) => t.status === "running");
    if (listHasInFlight) state.refreshList();

    // Keep pipeline view fresh while the active task is running
    if (state.activeTaskId && state.activeTaskDetail?.status === "running") {
      state.refreshActive();
    }
  }, 2000);
}
