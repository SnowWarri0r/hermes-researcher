/**
 * Discord webhook delivery — send research reports to a channel.
 * Uses Discord embeds for rich formatting.
 */

const MAX_EMBED_DESC = 4096;
const MAX_CONTENT = 2000;

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export async function sendToDiscord(opts: {
  webhookUrl: string;
  goal: string;
  report: string;
  mode: string;
  duration?: number;
  tokens?: number;
  taskUrl?: string;
}): Promise<void> {
  if (!opts.webhookUrl) return;

  const color = 0x00d992; // emerald signal green

  // Build TL;DR from report
  const tldrMatch = opts.report.match(/##\s*TL;?DR\s*\n+([\s\S]*?)(?=\n##\s|\n$)/i);
  const tldr = tldrMatch?.[1]?.trim().slice(0, 300) || opts.report.slice(0, 300);

  // Main embed with summary
  const embeds: DiscordEmbed[] = [
    {
      title: opts.goal.length > 250 ? opts.goal.slice(0, 247) + "..." : opts.goal,
      description: tldr,
      color,
      fields: [
        { name: "Mode", value: opts.mode, inline: true },
        ...(opts.duration ? [{ name: "Duration", value: `${opts.duration.toFixed(1)}s`, inline: true }] : []),
        ...(opts.tokens ? [{ name: "Tokens", value: opts.tokens > 1000 ? `${(opts.tokens / 1000).toFixed(1)}k` : String(opts.tokens), inline: true }] : []),
      ],
      footer: { text: "Hermes Researcher" },
      timestamp: new Date().toISOString(),
    },
  ];

  // Split full report into embed chunks (4096 char limit per embed description)
  const reportChunks = splitReport(opts.report, MAX_EMBED_DESC);
  for (let i = 0; i < Math.min(reportChunks.length, 9); i++) { // Discord max 10 embeds per message
    embeds.push({
      description: reportChunks[i],
      color: 0x3d3a39, // charcoal for report body
    });
  }

  try {
    const res = await fetch(opts.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: embeds.slice(0, 10),
        ...(opts.taskUrl ? { content: `[View full report](${opts.taskUrl})` } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`Discord webhook failed: ${res.status} ${await res.text()}`);
    }
  } catch (e) {
    console.error("Discord webhook error:", e);
  }
}

function splitReport(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
