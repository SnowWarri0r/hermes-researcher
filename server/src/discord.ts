/**
 * Discord webhook delivery — send research reports to a channel.
 * Summary as embed, full report as .md file attachment.
 */

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
}): Promise<void> {
  if (!opts.webhookUrl) return;

  const color = 0x00d992; // emerald signal green

  // Build TL;DR from report
  const tldrMatch = opts.report.match(/##\s*TL;?DR\s*\n+([\s\S]*?)(?=\n##\s|\n$)/i);
  const tldr = tldrMatch?.[1]?.trim().slice(0, 800) || opts.report.slice(0, 800);

  const embed: DiscordEmbed = {
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
  };

  // Use multipart/form-data to send embed + report as .md file attachment
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ embeds: [embed] }));

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `report-${dateStr}.md`;
  const fileBlob = new Blob([opts.report], { type: "text/markdown" });
  form.append("files[0]", fileBlob, fileName);

  try {
    const res = await fetch(opts.webhookUrl, { method: "POST", body: form });
    if (!res.ok) {
      console.error(`Discord webhook failed: ${res.status} ${await res.text()}`);
    }
  } catch (e) {
    console.error("Discord webhook error:", e);
  }
}
