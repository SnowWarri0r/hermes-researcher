import { jsonrepair } from "jsonrepair";
import type { Plan } from "../../shared/types.ts";

function styleGuide(language?: string): string {
  const langRule = language
    ? `\n- **Write the ENTIRE report in ${language}.** All headings, prose, labels, and descriptions must be in ${language}. Code, URLs, and proper nouns stay as-is.`
    : "";

  return `## Style rules

- Produce a **standalone research report** — an analyst's synthesis, not a news summary.${langRule}
- Do not address the reader directly ("you", "your", "let me know"). Write in third person.
- Do not offer follow-ups, apologize for limitations, or narrate your process.
- Do not include a closing sign-off.
- Use Markdown: \`##\` / \`###\` headings, bullet / numbered lists, tables, fenced code blocks with language tags.
- Lead with a "## TL;DR" section (1–3 sentences distilling the **main thesis**, not a topic list).
- Cite sources inline with Markdown links when making specific claims.

## Anti-patterns to avoid

- ❌ **Running account / 流水账**: "source A reported X. source B reported Y. source C reported Z." — this is aggregation, not analysis.
- ❌ **Each section = one source**: sections should be **themes** that cut across sources, not one-source-per-section.
- ❌ **Passive reporting**: "the article says..." / "some users discussed..." — make claims with authority.
- ❌ **Hedging without cause**: avoid "may", "might", "could potentially" unless the evidence genuinely warrants it.
- ❌ **Bullet-list-everything**: prose paragraphs for analysis; bullets only for discrete enumerable items.

## Required analytical moves

- **Signal vs noise**: explicitly call out what's new/important vs hype/repetition.
- **Cross-source synthesis**: when two or more sources touch a theme, combine their evidence into one paragraph. Cite all of them.
- **Contradictions**: if sources disagree, name the disagreement and take a stance when evidence permits.
- **Weak signals / implications**: go beyond what's literally in the findings — what does this mean for the reader, practically?
- **Numbers over adjectives**: prefer "58% improvement, 401 upvotes, $12M raise" over "significant", "popular", "well-funded".

## Voice — write like a human analyst, NOT like an AI

AI-generated writing has a distinctive bad smell. Actively resist it:

- **Banned phrases** (do NOT use these or their translations): "值得关注", "核心在于", "本质上", "这说明", "这意味着", "从X来看", "某种程度上", "不难发现", "一方面...另一方面", "正在成为", "结构性的", "范式", "分水岭", "底层逻辑", "赋能", "打通", "落地", "破圈", "闭环". English equivalents equally banned: "it's worth noting", "fundamentally", "at its core", "this suggests that", "this means that", "it's becoming clear", "paradigm shift", "game-changer", "disruptive", "leverages", "unpack".
- **No meta-commentary after every paragraph**: don't end paragraphs with "这说明...", "这意味着...", "换句话说...". If a fact is worth stating, state it. If a conclusion is worth drawing, draw it ONCE in the section summary, not after every data point.
- **No stacked adjectives**: "清晰的、稳定的、可控的" is AI filler. Pick ONE precise word or drop the modifier entirely.
- **No bold-word soup**: at most 1-2 bolded terms per paragraph, and only when the reader truly needs to scan for them. Bolding five phrases per paragraph is AI nervousness, not emphasis.
- **No "can be categorized into" / "呈现出X种特征"**: don't artificially systematize. If there are three things, list three things. Don't claim they form "three dimensions" or "a framework".
- **Concrete over abstract**: "Anthropic 在 4/15 发布 Claude Code Routines，文档允许模型按预设流程连续调用 15 个工具" beats "Anthropic 推进了 agent 工作流的产品化进程".
- **Don't narrate importance**: "this is important because..." is almost always telling, not showing. Replace with the concrete detail that makes it important.
- **Tight sentences**: kill every phrase that doesn't add information. "在 2026 年 4 月这个时间节点上" → "4 月".
- **Opinions with teeth**: when the evidence supports a judgment, state it flatly. "GLM-5.1 的 Terminal-Bench 分数很可能在实际生产环境会打折" beats "GLM-5.1 的评分值得进一步观察".`;
}

// ---------------------------------------------------------------------------
// 1. PLAN — produce structured research plan as JSON
// Budget: ~300 words output. This is a routing phase, not content.
// ---------------------------------------------------------------------------
export function planPrompt(opts: {
  goal: string;
  context: string;
  toolsets: string[];
  language?: string;
}): string {
  const toolsetsBlock =
    opts.toolsets.length > 0
      ? `\nAvailable toolsets: ${opts.toolsets.join(", ")}`
      : "";
  return `# Research planning

Decompose the user's goal into a structured research plan. You are the planner, NOT the researcher — produce questions for other workers to investigate in parallel.

## User goal

${opts.goal}
${opts.context ? `\n## Context\n\n${opts.context}\n` : ""}${toolsetsBlock}

## Output format

First, a short **Reasoning** section (under 150 words): identify the core dimensions of this goal (e.g. technical mechanism, comparative analysis, practical constraints, risk factors). Explain how you're splitting them into non-overlapping questions.

Then output the plan as JSON inside a fenced code block with language "json". Schema:

\`\`\`json
{
  "sections": ["TL;DR", "Section B", "..."],
  "questions": [
    {"id": "Q1", "title": "specific question", "approach": "concrete search strategy + data sources"},
    {"id": "Q2", "title": "...", "approach": "..."}
  ]
}
\`\`\`

## Rules for good questions

- **Decompose by analytical dimension, NOT by data source.** This is the most common mistake. If the goal mentions sources like "Hacker News, arXiv, Hugging Face", do NOT produce "Q1: what's on HN, Q2: what's on arXiv...". That forces each branch to be a one-source listing → the final report becomes an aggregation with no synthesis. Instead, split by **what you're looking for** — themes, signals, dimensions — and let each branch search ACROSS sources for evidence of that theme.
    - ❌ Bad: "Q1: HN top AI posts / Q2: HF top models / Q3: arXiv top papers / Q4: cross-source synthesis"
    - ✅ Good: "Q1: biggest technical release/breakthrough / Q2: dominant community sentiment / Q3: emerging research direction / Q4: industry moves (funding/hiring/product) / Q5: weak signals for future trends" — each branch searches HN + HF + arXiv + news for evidence of that theme.
- **Non-overlapping**: each question covers a distinct angle. No two questions should return similar search results.
- **Actionable**: each question must be answerable by searching the web, reading docs, or running code. Avoid meta-questions like "What is the background?" or "Why is this important?"
- **Specific**: "What are the latency/throughput benchmarks of vLLM vs TGI on A100?" not "Compare inference frameworks".
- **Approach must be concrete**: name specific search queries, websites, APIs, or data sources. "Search GitHub issues for memory leak reports" not "investigate issues". Include multiple sources in the approach when cross-source evidence strengthens the answer.
- **Cover multiple dimensions**: consider what/how/why/comparison/tradeoff/risk angles as appropriate for the goal.
- **Use concrete dates, never deictic time references.** Search engines cannot resolve "today", "今日", "this week", "recent", "最近". Every time reference must be an explicit date (e.g. "2026-04-16") or date range ("2026-04-14 to 2026-04-16"). Copy the dates from the goal verbatim. This applies to both question titles and approach text.
    - ❌ Bad: "今日 HN 上最热的 AI 话题" / "What are recent arXiv papers on..."
    - ✅ Good: "2026-04-16 当天 HN 上最热的 AI 话题" / "arXiv papers published 2026-04-14 to 2026-04-16 on..."

## Rules for plan structure

- 3–7 sections. 3–6 questions.
- If the goal is narrow/trivial, produce 1 question and 2 sections.
- Sections should map to report headings, not mirror questions 1:1.
- Valid JSON only.`;
}

// ---------------------------------------------------------------------------
// 2. RESEARCH — investigate ONE question. Budget: 300-800 words.
// ---------------------------------------------------------------------------
export function researchPrompt(opts: {
  goal: string;
  question: { id: string; title: string; approach: string };
  context: string;
}): string {
  return `# Research: ${opts.question.id} — ${opts.question.title}

Investigate this ONE question for a larger research task. Other workers handle other questions in parallel.

## Overall goal (context only)

${opts.goal}
${opts.context ? `\n## Context\n\n${opts.context}\n` : ""}

## Your question

**${opts.question.title}**

Approach: ${opts.question.approach}

## Search guidance

- **Use concrete dates in search queries, never deictic time references.** Search engines and APIs cannot resolve "today", "今日", "recent", "this week", "latest". When the question is time-scoped, extract the explicit date(s) from the question/goal and embed them in every search query. For date-ranged sources (arXiv, news, GitHub), use the API's date-filter params rather than hoping the results are sorted.
- When filtering to a specific day, also check the day before and day after to catch timezone-shifted content.

## Output rules

- Produce raw **findings**, NOT a polished report section.
- Concrete facts, data, code examples, statistics. Cite URLs inline.
- **Timestamp each fact when relevant.** Write "On 2026-04-16, X released Y" not "X recently released Y". Downstream synthesis needs absolute dates.
- Flag gaps or conflicting sources under "## Unresolved".
- **300–800 words max.** Be dense, not verbose. Every sentence should carry information.
- Do NOT repeat the question or goal in your output.

## Required: preserve raw quotes

After your findings, add a section \`## Raw quotes\` with **3–6 direct excerpts** from the sources you cited. Each quote:
- In original language (don't translate), inside \`> blockquote\` format
- Under 200 characters
- Attribute with source + URL immediately after: \`> "original text" — Source name (URL)\`

These quotes will be used downstream as evidence the final report can cite verbatim. Prefer: product claims from company blogs, numeric results from papers, specific complaints from comment threads, direct statements from founders/researchers. AVOID quotes that are just restating common facts.`;
}

// ---------------------------------------------------------------------------
// Compress research findings for the draft phase
// ---------------------------------------------------------------------------
const MAX_FINDING_CHARS = 2000;

export function compressFindings(
  findings: { questionId: string; title: string; output: string }[]
): { questionId: string; title: string; output: string }[] {
  return findings.map((f) => {
    if (f.output.length <= MAX_FINDING_CHARS) return f;

    // Keep headings + first sentence per section + all bullet points + links
    const lines = f.output.split("\n");
    const kept: string[] = [];
    let budget = MAX_FINDING_CHARS;
    let afterHeading = false;

    for (const line of lines) {
      if (budget <= 0) break;
      const trimmed = line.trim();

      if (trimmed.startsWith("#")) {
        kept.push(line);
        budget -= line.length;
        afterHeading = true;
      } else if (afterHeading && trimmed.length > 0) {
        kept.push(line);
        budget -= line.length;
        afterHeading = false;
      } else if (
        trimmed.startsWith("- ") ||
        trimmed.startsWith("* ") ||
        /^\d+\./.test(trimmed)
      ) {
        kept.push(line);
        budget -= line.length;
      } else if (trimmed.match(/\[.*?\]\(https?:\/\//)) {
        kept.push(line);
        budget -= line.length;
      }
    }

    return {
      ...f,
      output: `[Condensed from ${f.output.length} chars]\n\n${kept.join("\n")}`,
    };
  });
}

// ---------------------------------------------------------------------------
// 3a. OUTLINE — produce a structured outline BEFORE prose.
// Forces commitment to claims + evidence before the LLM starts generating
// AI-flavored boilerplate. Uses lite phase (chat completions, no tools).
// ---------------------------------------------------------------------------
export function outlinePrompt(opts: {
  goal: string;
  plan: Plan;
  findings: { questionId: string; title: string; output: string }[];
}): string {
  const compressed = compressFindings(opts.findings);
  const findingsBlock = compressed
    .map((f) => `### ${f.questionId}: ${f.title}\n\n${f.output}`)
    .join("\n\n---\n\n");

  return `# Outline the report

Before writing prose, commit to **what each section will argue** and **what evidence it will use**. Do NOT write paragraphs.

## Goal
${opts.goal}

## Planned sections
${opts.plan.sections.map((s) => `- ${s}`).join("\n")}

## Findings
${findingsBlock}

## Output format

For each section, produce:

\`\`\`
## <section name>
claim: <one sentence — the thesis of this section>
- fact: <short phrase> — <source short name> (<URL or Q-id>)
- fact: <short phrase> — <source short name> (<URL or Q-id>)
- fact: ...
\`\`\`

Rules:
- Every section must lead with a **claim sentence**. If a section has no claim, merge it or drop it.
- 2–5 facts per section, each a **short phrase** — not a full sentence. Cite the source.
- Do NOT write prose, transitions, or commentary. This is a skeleton, not a draft.
- 2–3 sentences MAX for the TL;DR claim.
- If two planned sections would make the same argument, merge them.

Example (English but same structure applies for Chinese):

\`\`\`
## TL;DR
claim: 本月开源模型的卖点从会聊天转向了能执行任务

## agent 能力成为主战场
claim: 三个月内发布的顶级开源模型都把 agent 能力放在 README 顶部
- fact: GLM-5.1 宣传 SWE-Bench 58.4, 多千次 tool calls — hf.co (Q2)
- fact: MiniMax-M2.7 自称 3 分钟事故恢复 — hf.co (Q2)
- fact: Claude Code Routines HN 401 upvotes — news.ycombinator.com (Q1)
\`\`\``;
}

// ---------------------------------------------------------------------------
// 3. DRAFT — synthesize plan + compressed findings
// ---------------------------------------------------------------------------
export function draftPrompt(opts: {
  goal: string;
  context: string;
  plan: Plan;
  findings: { questionId: string; title: string; output: string }[];
  outline?: string;
  language?: string;
}): string {
  const compressed = compressFindings(opts.findings);
  const findingsBlock = compressed
    .map((f) => `### ${f.questionId}: ${f.title}\n\n${f.output}`)
    .join("\n\n---\n\n");

  const outlineBlock = opts.outline
    ? `\n## Outline to expand (follow this structure — do NOT add or skip sections)\n\n${opts.outline}\n`
    : "";

  return `# Report drafting

## Writer persona

You write like a senior industry analyst for a publication such as *The Information*, *Stratechery*, or *36氪深度*. Your voice is:

- **Direct**: you state what you think, not what "some may argue".
- **Specific**: every generalization is backed by a name, number, or quote.
- **Opinionated**: when the evidence supports a judgment, you take the position. You don't hide behind "值得观察".
- **Spare**: you kill every word that doesn't earn its place. No "一方面...另一方面" theater.
- **Unimpressed**: you assume the reader already knows what an LLM is. You don't explain, you analyze.

## Goal

${opts.goal}
${opts.context ? `\n## Context\n\n${opts.context}\n` : ""}
${outlineBlock}
## Research findings (raw input from parallel investigations)

${findingsBlock}

## How to write

1. **Follow the outline above verbatim** if provided. Don't add sections. Don't merge sections the outline separates.
2. **Each section: lead with the claim, then marshal evidence.** Not "A happened. B happened. C happened." but "X is true — A (source), B (source), C (source) all point the same way."
3. **Use direct quotes** from the raw findings when a source said it more vividly than you could summarize. Keep quotes short (<30 words), in quotation marks, with citation.
4. **TL;DR: state the thesis in one sentence.** Not "we investigated X, Y, Z". Not "综合来看, 2026-04-16...". Just: what's the single most important thing the reader should know?
5. **Don't restate findings. Synthesize them.** Draft only adds value if it says something the raw findings didn't state directly.

## Style example — GOOD vs BAD

BAD (AI slop — reject):
> ## AI 代理能力成为新战场
>
> 2026-04-16 的 AI 领域呈现出明显的结构性转变：**模型能力正在从单纯对话向代理执行迁移**。一方面，GLM-5.1 在 README 中强调 agent 能力；另一方面，MiniMax-M2.7 也把 log analysis 作为核心卖点。这在某种程度上说明，开源社区正在对"能执行任务"的模型形成共识。

GOOD (direct, specific):
> ## Agent 能力取代参数规模成为开源卖点
>
> 本周发布的三个主流开源模型都把 agent 能力写进 README 顶部。GLM-5.1 直接标 SWE-Bench 58.4，强调"数百轮 tool calls"（[hf.co/zai-org/GLM-5.1](https://huggingface.co/zai-org/GLM-5.1)）。MiniMax-M2.7 更激进：宣称把事故恢复压缩到"under three minutes"（[hf.co/MiniMaxAI/MiniMax-M2.7](https://huggingface.co/MiniMaxAI/MiniMax-M2.7)）。参数规模、benchmark 平均分——这两个过去的主卖点——几乎消失了。这不代表它们不重要，而是已经沦为背景；真正影响采购决策的指标换了。

Notice in the GOOD example: one bolded phrase, no "值得关注", no "一方面...另一方面", opinions stated flatly, specifics with URLs, final line delivers a judgment.

${styleGuide(opts.language)}`;
}

// ---------------------------------------------------------------------------
// 4. CRITIQUE — budget: 300-500 words. Focused, not exhaustive.
// ---------------------------------------------------------------------------
export function critiquePrompt(opts: {
  goal: string;
  draft: string;
}): string {
  return `# Critique this report draft

## Goal it should address

${opts.goal}

## Draft

${opts.draft}

## Output

Produce a **concise** critique (300–500 words max). Focus on the top issues only:

1. **AI voice detection (AI 味)** — does the draft use phrases like "值得关注", "这说明", "核心在于", "本质上", "正在成为", "一方面...另一方面", "某种程度上", "it's worth noting", "fundamentally", "this suggests that"? Does it bold 5+ words per paragraph? Does it end paragraphs with meta-commentary ("这说明X正在Y")? Does it artificially systematize findings into "N dimensions" / "N 个维度"? Flag every instance — this is a top problem.
2. **Running-account detection (流水账)** — are sections organized "one-source-per-section" instead of by theme? Does the draft just summarize each finding in sequence without synthesis?
3. **Abstract over concrete** — does the draft say "推进了 agent 工作流的产品化进程" when it could say "发布了 Claude Code Routines 允许模型连续调用 15 个工具"? Flag abstract generalities that hide concrete details.
4. **Weak thesis** — does the TL;DR state a clear takeaway, or just list what was investigated?
5. **Missing analysis** — where does the draft restate findings without adding interpretation, cross-source connection, or implications?
6. **Content gaps** — what important aspects are missing?
7. **Weak claims** — assertions that lack evidence or overhedge ("may", "could", "some").
8. **Citations** — missing on specific claims, or suspicious sources.

End with a **numbered priority fix list** (top 3–5 changes). For each, specify: which section needs work, what's wrong, and what the revised section should do differently.

Be direct and specific. Don't pad with praise.`;
}

// Slim critique — used with conversation_history that already contains the draft
export function critiqueInstructionPrompt(opts: { goal: string }): string {
  return `# Critique the report I just produced

## Goal it should address

${opts.goal}

## Output

Produce a **concise** critique (300–500 words max). Focus on the top issues only:

1. **AI voice detection (AI 味)** — does the draft use phrases like "值得关注", "这说明", "核心在于", "本质上", "正在成为", "一方面...另一方面", "某种程度上", "it's worth noting", "fundamentally", "this suggests that"? Does it bold 5+ words per paragraph? Does it end paragraphs with meta-commentary ("这说明X正在Y")? Does it artificially systematize findings into "N dimensions" / "N 个维度"? Flag every instance — this is a top problem.
2. **Running-account detection (流水账)** — are sections organized "one-source-per-section" instead of by theme? Does the draft just summarize each finding in sequence without synthesis?
3. **Abstract over concrete** — does the draft say "推进了 agent 工作流的产品化进程" when it could say "发布了 Claude Code Routines 允许模型连续调用 15 个工具"? Flag abstract generalities that hide concrete details.
4. **Weak thesis** — does the TL;DR state a clear takeaway, or just list what was investigated?
5. **Missing analysis** — where does the draft restate findings without adding interpretation, cross-source connection, or implications?
6. **Content gaps** — what important aspects are missing?
7. **Weak claims** — assertions that lack evidence or overhedge ("may", "could", "some").
8. **Citations** — missing on specific claims, or suspicious sources.

End with a **numbered priority fix list** (top 3–5 changes). For each, specify: which section needs work, what's wrong, and what the revised section should do differently.

Be direct and specific. Don't pad with praise.`;
}

// ---------------------------------------------------------------------------
// 5. REVISE — incorporate critique
// ---------------------------------------------------------------------------
export function revisePrompt(opts: {
  goal: string;
  context: string;
  draft: string;
  critique: string;
  toolsets: string[];
  language?: string;
}): string {
  const toolsetsBlock =
    opts.toolsets.length > 0
      ? `\n\nYou may use these toolsets for fact-checking if needed: ${opts.toolsets.join(", ")}`
      : "";

  return `# Final revision

Apply this critique to produce the final report.

## Goal

${opts.goal}${toolsetsBlock}

## Draft

${opts.draft}

## Critique

${opts.critique}

## Rules

- Output ONLY the final report. No meta-commentary about what changed.
- Address the priority fix list. Strengthen weak claims or remove them.
- The report must read as a standalone document.

${styleGuide(opts.language)}`;
}

// ---------------------------------------------------------------------------
// 6. EDITOR pass — polish language only, no structural change.
// Fights AI voice that survived revise. Uses lite phase.
// ---------------------------------------------------------------------------
export function editorPrompt(opts: { goal: string; language?: string }): string {
  return `# Copy edit

You are the copy editor for a top-tier technology publication. The writer submitted a revised draft. Your job: **tighten the language, kill AI voice, preserve all substance**.

## Goal the report addresses
${opts.goal}

## What to change
- **Strike banned phrases.** Remove or rewrite every instance of: "值得关注", "核心在于", "本质上", "这说明", "这意味着", "某种程度上", "一方面...另一方面", "正在成为", "结构性", "范式", "不难发现", "从X来看", "it's worth noting", "fundamentally", "this suggests", "this means that", "paradigm shift", "disruptive", "leverages".
- **Reduce bolding.** Max 2 bolded phrases per paragraph. Strike bolding that's there for AI visual rhythm rather than scannable emphasis.
- **Break repetitive rhythm.** If three consecutive sentences start with the same connector (然而/同时/此外), rewrite two of them.
- **Prefer specific over abstract.** Replace "推进了产品化进程" with the concrete action. Replace "生态正在成熟" with the specific evidence of maturation.
- **Compress.** "在 2026 年 4 月这一时间节点" → "4 月". Kill redundant modifiers. One adjective is plenty.
- **Kill meta-commentary tails.** Paragraphs ending with "这说明X正在Y" usually say nothing — cut them.

## What NOT to change
- All facts, numbers, dates, names, citations, URLs must remain exactly as the writer had them.
- All section headings and ordering stay.
- The writer's opinions and judgments stay — sharpen their phrasing, don't dilute them.
- Do not add new citations or claims.
${opts.language ? `- Language: keep in ${opts.language}.` : ""}

## Output
Output ONLY the final edited report. No preamble, no change log, no "here's the edited version", no sign-off. Start directly with the \`## TL;DR\` heading.`;
}

// Slim revise — used with conversation_history that contains draft + critique
export function reviseInstructionPrompt(opts: {
  goal: string;
  toolsets: string[];
  language?: string;
}): string {
  const toolsetsBlock =
    opts.toolsets.length > 0
      ? `\n\nYou may use these toolsets for fact-checking if needed: ${opts.toolsets.join(", ")}`
      : "";

  return `# Final revision

Apply the critique above to produce the final report.

## Goal

${opts.goal}${toolsetsBlock}

## Rules

- Output ONLY the final report. No meta-commentary about what changed.
- Address the priority fix list. Strengthen weak claims or remove them.
- The report must read as a standalone document.

${styleGuide(opts.language)}`;
}

// ---------------------------------------------------------------------------
// Quick mode — single call
// ---------------------------------------------------------------------------
export function directReportPrompt(opts: {
  goal: string;
  context: string;
  toolsets: string[];
  language?: string;
  priorReport?: string;
  followupMessage?: string;
}): string {
  const toolsetsBlock =
    opts.toolsets.length > 0
      ? `\n\nAvailable toolsets: ${opts.toolsets.join(", ")}`
      : "";

  let p = `# Research task\n\n${opts.goal}`;
  if (opts.context) p += `\n\n## Context\n\n${opts.context}`;
  p += toolsetsBlock;

  if (opts.priorReport && opts.followupMessage) {
    p += `\n\n## Prior report\n\n${condensePriorReport(opts.priorReport)}`;
    p += `\n\n## Refinement request (INTERNAL — silently integrate, do not surface)\n\n${opts.followupMessage}`;
    p += `\n\n## Hard rules\n\n- Output the full new report.\n- Do NOT acknowledge this is a revision.`;
  }

  p += `\n\n${styleGuide(opts.language)}`;
  return p;
}

// ---------------------------------------------------------------------------
// B. Research adequacy gate — evaluate if findings cover the plan
// ---------------------------------------------------------------------------
export function researchAdequacyPrompt(opts: {
  goal: string;
  plan: Plan;
  findings: { questionId: string; title: string; output: string }[];
}): string {
  const findingsSummary = opts.findings
    .map((f) => `### ${f.questionId}: ${f.title}\n${f.output.slice(0, 600)}`)
    .join("\n\n");

  return `# Research adequacy check

Evaluate whether the research findings adequately cover the planned questions.

## Goal
${opts.goal}

## Planned questions
${opts.plan.questions.map((q) => `- ${q.id}: ${q.title}`).join("\n")}

## Findings (condensed)
${findingsSummary}

## Output (strict JSON)
\`\`\`json
{
  "adequate": true/false,
  "gaps": [
    {"questionId": "Q2", "issue": "only surface-level stats, no mechanism explanation"},
    {"questionId": "NEW", "title": "new question to investigate", "approach": "how to investigate"}
  ]
}
\`\`\`

Rules:
- "adequate" = true if ≥80% of questions have substantive findings (not just rephrased questions)
- Only flag real gaps — missing data, contradictions, or critical uncovered angles
- Max 3 gaps. If findings are good enough, return {"adequate": true, "gaps": []}
- NEW questions only if a critical angle was missed entirely`;
}

// ---------------------------------------------------------------------------
// D. Report quality self-evaluation — score after revise
// ---------------------------------------------------------------------------
export function reportQualityPrompt(opts: {
  goal: string;
  report: string;
}): string {
  return `# Report quality evaluation

Score this research report on a 1-10 scale.

## Goal
${opts.goal}

## Report
${opts.report.slice(0, 8000)}

## Output (strict JSON)
\`\`\`json
{
  "score": 7,
  "pass": true,
  "issues": ["issue 1 if any"]
}
\`\`\`

## Scoring guide
- 1-4: Major gaps, wrong information, or doesn't address the goal → pass=false
- 5-6: Addresses the goal but thin on evidence or missing key aspects → pass=false
- 7-8: Solid coverage with citations, minor improvements possible → pass=true
- 9-10: Exceptional depth and rigor → pass=true

Rules:
- Be honest, not generous. Most first drafts score 5-7.
- "pass" = true means acceptable to deliver. false means needs another revision.
- Max 3 issues, each under 20 words. Focus on fixable problems.
- If score ≥ 7, set pass=true even if minor issues exist.`;
}

// ---------------------------------------------------------------------------
// Followup context
// ---------------------------------------------------------------------------
const MAX_PRIOR_REPORT_CHARS = 6000;

function condensePriorReport(report: string): string {
  if (report.length <= MAX_PRIOR_REPORT_CHARS) return report;

  const lines = report.split("\n");
  const summary: string[] = [];
  let charBudget = MAX_PRIOR_REPORT_CHARS;

  for (const line of lines) {
    if (charBudget <= 0) break;
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      summary.push(line);
      charBudget -= line.length;
    } else if (
      summary.length > 0 &&
      summary[summary.length - 1].trim().startsWith("#") &&
      trimmed.length > 0
    ) {
      summary.push(line);
      charBudget -= line.length;
    } else if (
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      /^\d+\./.test(trimmed)
    ) {
      summary.push(line);
      charBudget -= line.length;
    }
  }

  return `[Condensed from ${report.length} chars]\n\n${summary.join("\n")}`;
}

export function followupContextPrompt(opts: {
  priorReport: string;
  followupMessage: string;
}): string {
  const condensed = condensePriorReport(opts.priorReport);

  return `### Prior report outline (condensed)

${condensed}

### Refinement request (INTERNAL — do not surface)

${opts.followupMessage}

Integrate the refinement naturally. Do NOT acknowledge this is a revision.`;
}

// ---------------------------------------------------------------------------
// Followup type detection — is this a minor tweak or a major revision?
// ---------------------------------------------------------------------------
export function isMinorRefinement(message: string): boolean {
  const lower = message.toLowerCase();
  const minorPatterns = [
    /fix\s+(typo|spelling|grammar|format)/,
    /改\s*(错字|格式|排版)/,
    /add\s+(a\s+)?link/,
    /加个?(链接|引用)/,
    /remove\s+(the\s+)?section/,
    /删(除|掉).{0,10}(章节|部分|段落)/,
    /rephrase/,
    /reword/,
    /换个说法/,
    /改写.{0,10}(句|段)/,
  ];
  return minorPatterns.some((p) => p.test(lower));
}

// ---------------------------------------------------------------------------
// Parse plan JSON
// ---------------------------------------------------------------------------
export function parsePlan(raw: string): Plan | null {
  // Try every ```json block AND raw text AND largest brace-balanced substring,
  // using jsonrepair as a last resort. Validates that result has sections+questions.
  const candidates: string[] = [];
  const blockRe = /```json\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(raw)) !== null) candidates.push(m[1]);
  // Also try anonymous fenced blocks
  const anonRe = /```\s*([\s\S]*?)```/g;
  while ((m = anonRe.exec(raw)) !== null) candidates.push(m[1]);
  candidates.push(raw);
  // Also extract the widest {...} substring
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    const parsed = tryParse(candidate.trim());
    if (parsed && Array.isArray(parsed.sections) && Array.isArray(parsed.questions)) {
      const sections: string[] = parsed.sections
        .filter((s: unknown) => typeof s === "string")
        .slice(0, 10);
      const questions = parsed.questions
        .filter((q: unknown) => typeof q === "object" && q !== null && "title" in (q as object))
        .slice(0, 8)
        .map((q: { id?: string; title: string; approach?: string }, i: number) => ({
          id: q.id || `Q${i + 1}`,
          title: String(q.title),
          approach: String(q.approach || "Search web and cite primary sources."),
        }));
      if (questions.length === 0) continue;
      return {
        sections: sections.length > 0 ? sections : ["TL;DR", "Details", "References"],
        questions,
      };
    }
  }
  return null;
}

function tryParse(text: string): { sections?: unknown; questions?: unknown } | null {
  try { return JSON.parse(text); } catch { /* fall through */ }
  try { return JSON.parse(jsonrepair(text)); } catch { /* fall through */ }
  return null;
}
