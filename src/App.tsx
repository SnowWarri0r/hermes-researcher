import { useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from "react-router";
import { Sidebar } from "./components/layout/Sidebar";
import { TaskCreator } from "./components/tasks/TaskCreator";
import { TaskList } from "./components/tasks/TaskList";
import { TaskDetail } from "./components/tasks/TaskDetail";
import { Settings } from "./components/Settings";
import { Knowledge } from "./components/Knowledge";
import { Schedules } from "./components/Schedules";
import { Templates } from "./components/Templates";
import { useTaskStore, startPolling } from "./store/tasks";
import { checkHealth } from "./api/client";
import { requestNotificationPermission } from "./hooks/useNotification";

/** Invisible component that syncs URL task ID → store */
function TaskOpener() {
  const { taskId } = useParams<{ taskId: string }>();
  const openTask = useTaskStore((s) => s.openTask);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);

  useEffect(() => {
    if (taskId && taskId !== activeTaskId) {
      openTask(taskId);
    }
  }, [taskId]);

  return null;
}

function TasksPage() {
  const counts = useTaskStore((s) => s.counts);
  const filterStatus = useTaskStore((s) => s.filterStatus);
  const setFilterStatus = useTaskStore((s) => s.setFilterStatus);

  const filters: { value: string; label: string; count: number }[] = [
    { value: "", label: "All", count: counts.all },
    { value: "running", label: "Running", count: counts.running },
    { value: "completed", label: "Done", count: counts.completed },
    { value: "failed", label: "Failed", count: counts.failed },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Mission header */}
      <div className="flex items-baseline gap-4">
        <div>
          <div className="text-[11px] text-slate-steel font-mono tracking-[0.2em] uppercase">
            Mission / tasks
          </div>
          <h1 className="text-[28px] font-medium tracking-[-0.02em] leading-[1.05] mt-1 text-snow">
            Active investigations
            <span className="text-emerald-signal ml-2.5">
              — {counts.running > 0 ? `${counts.running} running` : "idle"}
            </span>
          </h1>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {filters.map((f) => {
            const active = filterStatus === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFilterStatus(f.value)}
                className={`px-2.5 py-1 rounded-pill text-[11px] font-medium border transition-colors flex items-center gap-1.5 ${
                  active
                    ? "bg-emerald-dim border-emerald-signal text-emerald-signal"
                    : "bg-carbon border-charcoal text-slate-steel hover:text-parchment hover:border-charcoal-light"
                }`}
              >
                <span>{f.label}</span>
                <span className={`text-[10px] font-mono ${active ? "text-emerald-signal/80" : "text-slate-steel/70"}`}>
                  {f.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <TaskCreator />
      <TaskList />
    </div>
  );
}

function TaskDetailRoute() {
  return (
    <>
      <TaskOpener />
      <TaskDetail />
    </>
  );
}

function AppShell() {
  const setConnected = useTaskStore((s) => s.setConnected);
  const refreshList = useTaskStore((s) => s.refreshList);
  const location = useLocation();
  const isTaskDetail = location.pathname.startsWith("/tasks/");
  const isKnowledgeDetail = /^\/knowledge\/\d+/.test(location.pathname);
  const isSettingsPage = location.pathname.startsWith("/settings");
  const sidebarCollapsed = isTaskDetail || isKnowledgeDetail || isSettingsPage;

  const pollHealth = useCallback(async () => {
    const ok = await checkHealth();
    setConnected(ok);
  }, [setConnected]);

  useEffect(() => {
    pollHealth();
    refreshList();
    startPolling();
    requestNotificationPermission();
    const interval = setInterval(pollHealth, 15000);
    return () => clearInterval(interval);
  }, [pollHealth, refreshList]);

  const isKnowledge = location.pathname.startsWith("/knowledge");
  const isSettings = location.pathname.startsWith("/settings");

  return (
    <div className="h-full flex mc-ambient relative">
      <Sidebar collapsed={sidebarCollapsed} />
      {isTaskDetail ? (
        <Routes>
          <Route path="/tasks/:taskId" element={<TaskDetailRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : isKnowledge ? (
        <Routes>
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/knowledge/:entryId" element={<Knowledge />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : isSettings ? (
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <main className="flex-1 flex flex-col overflow-hidden relative z-[1]">
          <div className="flex-1 overflow-y-auto p-6">
            <Routes>
              <Route path="/" element={<TasksPage />} />
              <Route path="/schedules" element={<Schedules />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      )}
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
