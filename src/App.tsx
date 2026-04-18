import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { TaskCreator } from "./components/tasks/TaskCreator";
import { TaskList } from "./components/tasks/TaskList";
import { TaskDetail } from "./components/tasks/TaskDetail";
import { Settings } from "./components/Settings";
import { useTaskStore, startPolling } from "./store/tasks";
import { checkHealth } from "./api/client";

type View = "tasks" | "settings";

export function App() {
  const [view, setView] = useState<View>("tasks");
  const setConnected = useTaskStore((s) => s.setConnected);
  const refreshList = useTaskStore((s) => s.refreshList);

  const pollHealth = useCallback(async () => {
    const ok = await checkHealth();
    setConnected(ok);
  }, [setConnected]);

  useEffect(() => {
    pollHealth();
    refreshList();
    startPolling();
    const interval = setInterval(pollHealth, 15000);
    return () => clearInterval(interval);
  }, [pollHealth, refreshList]);

  return (
    <div className="h-full flex bg-abyss">
      <Sidebar view={view} onViewChange={setView} />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          {view === "tasks" ? (
            <div className="max-w-3xl mx-auto space-y-6">
              <TaskCreator />
              <TaskList />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              <Settings />
            </div>
          )}
        </div>
      </main>
      <TaskDetail />
    </div>
  );
}
