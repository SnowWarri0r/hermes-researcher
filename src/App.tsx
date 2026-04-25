import { useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from "react-router";
import { Sidebar } from "./components/layout/Sidebar";
import { TaskCreator } from "./components/tasks/TaskCreator";
import { TaskList } from "./components/tasks/TaskList";
import { TaskDetail } from "./components/tasks/TaskDetail";
import { Settings } from "./components/Settings";
import { Knowledge } from "./components/Knowledge";
import { Schedules } from "./components/Schedules";
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
  return (
    <div className="max-w-3xl mx-auto space-y-6">
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

  return (
    <div className="h-full flex mc-ambient relative">
      <Sidebar collapsed={isTaskDetail} />
      {isTaskDetail ? (
        <Routes>
          <Route path="/tasks/:taskId" element={<TaskDetailRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <main className="flex-1 flex flex-col overflow-hidden relative z-[1]">
          <div className="flex-1 overflow-y-auto p-6">
            <Routes>
              <Route path="/" element={<TasksPage />} />
              <Route path="/schedules" element={<Schedules />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route path="/settings" element={<div className="max-w-3xl mx-auto"><Settings /></div>} />
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
