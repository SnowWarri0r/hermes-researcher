import { store } from "./db.ts";
import { startHermesRun, streamHermesEvents } from "./hermes.ts";
import { reportChatPrompt } from "./prompt.ts";
import { getModelForPhase } from "./settings.ts";
import { broadcast } from "./runner.ts";
import type { ChatMessage, TaskEvent, TokenUsage } from "../../shared/types.ts";

// Build conversation_history for hermes from the SQLite chat history.
// The FIRST user turn gets the system/report context baked into its content
// (runs API accepts system role but we keep it simple as a user preamble +
// assistant ack). Subsequent turns carry just their own text.
function buildConversationHistory(
  systemPrompt: string,
  priorMessages: ChatMessage[],
): { role: string; content: string }[] {
  const history: { role: string; content: string }[] = [];
  // Synthetic preamble so the assistant has context without relying on
  // a potentially-unsupported system role.
  history.push({ role: "user", content: systemPrompt });
  history.push({
    role: "assistant",
    content: "Understood. I have the report and the research findings. Ask me anything about them, or ask me to search for something new.",
  });

  for (const m of priorMessages) {
    if (m.status !== "completed") continue; // skip in-progress assistant messages
    history.push({ role: m.role, content: m.content });
  }
  return history;
}

/**
 * Kick off an assistant response to a user message. Streams deltas via broadcast;
 * persists the full assistant message when complete. Non-blocking — caller
 * should fire-and-forget after persisting the user message.
 */
export async function runChatMessage(opts: {
  taskId: string;
  userMessage: ChatMessage;
}): Promise<void> {
  const { taskId, userMessage } = opts;
  const task = store.getTask(taskId);
  if (!task) return;

  // Anchor to the latest completed turn's report + phases
  const completedTurns = task.turns.filter((t) => t.status === "completed" && t.report);
  const latestTurn = completedTurns[completedTurns.length - 1];
  if (!latestTurn) {
    // Task has no completed report — chat is nonsensical. Persist an error message.
    const errorMsg = store.addChatMessage({
      taskId,
      turnId: null,
      role: "assistant",
      content: "No completed report on this task yet — chat needs a report to ground in.",
      status: "failed",
      createdAt: Date.now(),
    });
    broadcast(taskId, {
      event: "chat.message.completed",
      data: { messageId: errorMsg.id, content: errorMsg.content, status: "failed" },
    });
    return;
  }

  // Pull research findings from the latest turn's research phases
  const findings = latestTurn.phases
    .filter((p) => p.kind === "research" && p.status === "completed")
    .map((p) => {
      // phase label format: "Q1: question title" — split to recover id + title
      const m = p.label.match(/^([QS]\d+):\s*(.+?)(?:\s*\(.*\))?$/);
      return {
        questionId: m?.[1] ?? `Q${p.branch + 1}`,
        title: m?.[2] ?? p.label,
        output: p.output,
      };
    });

  const systemPrompt = reportChatPrompt({
    goal: task.goal,
    report: latestTurn.report,
    findings,
    language: task.language || undefined,
  });

  // Get all prior chat messages, excluding this new user message's implicit
  // pair-partner (the assistant message we're about to stream).
  const allMessages = store.listChatMessages(taskId);
  const priorMessages = allMessages.filter((m) => m.id <= userMessage.id && m.status === "completed");

  const conversationHistory = buildConversationHistory(systemPrompt, priorMessages);

  // Create the assistant message record in "running" state so UI can render
  // the streaming cursor immediately.
  const assistantMsg = store.addChatMessage({
    taskId,
    turnId: latestTurn.id,
    role: "assistant",
    content: "",
    status: "running",
    createdAt: Date.now(),
  });

  broadcast(taskId, {
    event: "chat.message.started",
    data: { messageId: assistantMsg.id, role: "assistant", turnId: latestTurn.id },
  });

  let accumulated = "";
  const events: TaskEvent[] = [];
  let usage: TokenUsage | undefined;

  try {
    // The runs API is the only path with tool calls available in this app.
    // Pass conversation_history + the new user message as input.
    const model = getModelForPhase("research"); // same tool-capable model as research
    const runId = await startHermesRun(userMessage.content, model, conversationHistory);

    for await (const event of streamHermesEvents(runId)) {
      if (event.event === "message.delta" && event.delta) {
        accumulated += event.delta;
        broadcast(taskId, {
          event: "chat.delta",
          data: { messageId: assistantMsg.id, delta: event.delta },
        });
      } else if (event.event === "run.completed") {
        if (event.usage) usage = event.usage as TokenUsage;
      } else {
        // All other events (tool.started, tool.completed, reasoning.available,
        // reasoning.delta, etc.) flow through as-is so the UI can show progress.
        // Use `payload` (not `event`) to avoid a field-name collision with the
        // outer SSE event name when the client spreads the JSON into its event.
        events.push(event);
        broadcast(taskId, {
          event: "chat.event",
          data: { messageId: assistantMsg.id, payload: event },
        });
      }
    }

    const completedAt = Date.now();
    store.completeChatMessage({
      id: assistantMsg.id,
      content: accumulated,
      events,
      usage,
      status: "completed",
      completedAt,
    });
    broadcast(taskId, {
      event: "chat.message.completed",
      data: {
        messageId: assistantMsg.id,
        content: accumulated,
        usage,
        status: "completed",
      },
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const completedAt = Date.now();
    store.completeChatMessage({
      id: assistantMsg.id,
      content: accumulated,
      events,
      status: "failed",
      error: errMsg,
      completedAt,
    });
    broadcast(taskId, {
      event: "chat.message.failed",
      data: { messageId: assistantMsg.id, error: errMsg },
    });
  }
}
