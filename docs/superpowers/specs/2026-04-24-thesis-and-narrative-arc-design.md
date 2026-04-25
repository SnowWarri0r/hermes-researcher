# Thesis + Narrative Arc — Design Spec

**Date**: 2026-04-24
**Status**: design approved, pending implementation plan
**Owner**: Snow
**Related work**: extends the plan-review phase added on 2026-04-23

## Context

Deep-research reports currently read like "five answers to five questions" stapled together:
- Draft uses `research.questions` as de facto section headings (`## Q1: ... / ## Q2: ...`).
- `plan.sections` is produced by the planner but is never authoritatively used by outline or draft.
- Sections don't reference each other — no through-line, no connective tissue.
- TL;DR summarizes topics, not a judgment; the report has no central claim.

The reader ends up with a survey of facts rather than an analyst's synthesis.

**Goal**: transform the report from "Q&A pile" into "one argumentative piece with a thesis" — each section carries a sub-claim, sections are chained by explicit connectors, and the TL;DR opens with a paraphrase of the central claim.

**Approach**: combine two orthogonal changes:
- **A. Sections/Questions decoupling** — make `plan.sections` the skeleton; research findings are reorganized by theme into those sections, not 1:1 mapped to questions.
- **B. Thesis phase** — new phase between research and outline that produces a refutable central claim, 2-4 sub-claims, and a `section_plan` mapping sections to sub-claims.

Both modes (standard and deep) get thesis + outline. Quick mode has no plan and is unchanged.

## Pipeline Changes

### Deep mode (new)

```
plan → plan-review → research → adequacy-gate
    → thesis → outline → draft → critique → revise → quality-loop → editor
```

### Standard mode (new)

```
plan → plan-review → research → thesis → outline → draft → critique → revise
```

Standard's adequacy-gate, quality-loop, and editor remain excluded (those are intentionally deep-only).

### Quick mode

Unchanged — no plan, no thesis, direct report.

### Seq numbering (deep)

| phase         | seq | branch | kind       |
|---------------|-----|--------|------------|
| plan          | 0   | 0      | plan       |
| plan review   | 0   | 1      | critique   |
| plan (revised)| 0   | 2      | plan       |
| research      | 1   | 0..N   | research   |
| thesis        | 2   | 0      | critique   |
| outline       | 3   | 0      | critique   |
| draft         | 4   | 0      | draft      |
| critique      | 5   | 0      | critique   |
| revise        | 6   | 0      | revise     |
| (quality loop adds more revise+critique at seq 7,8…) | | | |
| editor        | final+1 | 0 | revise   |

Outline/draft/critique/revise/editor all shift by +1 from current numbering.

## Thesis Phase Spec

**Inputs**: `goal`, `plan.sections` (array of section names), `research findings` (all questions concatenated, not truncated).

**Prompt style**: CL4R1T4S-inspired XML tags (`<role>`, `<inputs>`, `<rules>`, `<output_format>`, `<important>`), consistent with planReviewPrompt.

**Output**: short reasoning prose (≤150 words) + one JSON block with this schema:

```json
{
  "central_claim": "≤35 字，一句话，可反驳的判断",
  "sub_claims": [
    {"id": "C1", "text": "...", "evidence_from": ["Q1", "Q3"]},
    {"id": "C2", "text": "...", "evidence_from": ["Q2"]},
    {"id": "C3", "text": "...", "evidence_from": ["Q4", "Q5"]}
  ],
  "section_plan": [
    {"section": "TL;DR",   "sub_claim": null, "role": "open with central_claim + preview arc"},
    {"section": "Setup",   "sub_claim": "C1", "role": "establish baseline, plant hook for C2"},
    {"section": "Core",    "sub_claim": "C2", "role": "carry thesis, callback C1 opener"},
    {"section": "Tension", "sub_claim": "C3", "role": "acknowledge counter, resolve toward central"},
    {"section": "So what", "sub_claim": null, "role": "closer — what the reader should do differently"}
  ]
}
```

**Hard rules**:
- `central_claim` MUST be a refutable judgment, not a descriptive fact. Forbidden patterns: enumerations, summaries, non-committal hedges.
- `sub_claims`: 2–4 entries; each MUST cite at least one Q#.
- `section_plan` length = `plan.sections.length`. Section names come from `plan.sections` verbatim.
- Every `role` string MUST include an explicit connective instruction (`callback X`, `plant hook for Y`, `resolve toward central`). No vague roles.

**Fallback**: if JSON parse fails (even after jsonrepair), return `thesis = null`. Downstream (outline, draft) detect `thesis === null` and run in degraded mode (current behavior, no narrative arc).

**Phase implementation**: `runPhaseLite` with `kind: "critique"`, `label: "Thesis"`, streaming output so the user sees it live.

**Cache**: `PipelineCache.thesisOutput / thesisUsage / thesisParsed` (structured object, not re-parsed on retry).

## Outline Phase Changes

**Inputs** (new): `goal`, `thesis` (parsed object, or `null`), `plan.sections`, `research findings` (full, by Q#).

**Output** (Markdown skeleton, not JSON — draft consumes directly):

```
## Section: Setup (carries C1)

**Section claim**: <C1.text verbatim>
**Connection IN**: opening section — draws from central_claim
**Connection OUT**: last sentence plants "permission layer" — picked up by Core
**Key facts to include**:
- Q1: "Anthropic 4/19 Trusted Access for Cyber — $10M credits, hundreds of teams"
- Q3: "Google prepay billing w/ spend caps — procurement predictability"
**Length target**: ~250 字

## Section: Core (carries C2)
...
```

**Hard rules**:
- `section_plan` length & order MUST match `thesis.section_plan`.
- Each section MUST specify `Connection IN` + `Connection OUT` with **concrete anchor words** (not "承接上文").
- Each section MUST list ≥3 `Key facts`, each tagged `Q#` with a **specific number or quoted phrase** (not "discussion of X").
- Outline is pure skeleton — no prose paragraphs.
- TL;DR section: only `Connection OUT`. Final section: only `Connection IN`.
- Soft escape: if sections <3, merging IN/OUT into one line is allowed.

**Degraded mode** (thesis = null): skip narrative rules, fall back to current outline behavior.

**Prompt style**: XML tags + BAD/GOOD examples aimed specifically at "empty connector words".

**Cache**: existing `outlineOutput / outlineUsage` fields reused.

## Draft Prompt Changes

### Both modes

Draft receives `thesis` (parsed) + `outline` (markdown skeleton) + research findings (full).

**New hard rules** (appended to existing `styleGuide`):

```
## Hard rules — narrative arc (only when thesis is non-null)

- Heading format: use plan.sections names VERBATIM. NEVER "Q1: ..." / "Question 1: ...".
- TL;DR MUST open with a paraphrase of central_claim — not "this report discusses..."
- Each section's FIRST sentence MUST include the Connection IN anchor word from outline.
- Each section's LAST sentence MUST include the Connection OUT hook word (except the final section).
- Each section MUST restate or advance its assigned sub_claim at least once.
- Final section MUST contain one explicit "so what" — a reader's next action, a prediction, a judgment.

## BAD / GOOD

❌ BAD:
  "## Q3: 当天哪些论文值得注意？
   arXiv 上有 8 篇论文..."

✅ GOOD:
  "## 研究圈的跟进
   如果说应用层已经把 agent 当成既定事实（上一节提到的 43 条 HN 讨论），那
   研究圈本周的八篇论文就是在回答同一个问题的另一侧..."
```

### Standard mode specifics

Standard also gets outline phase (unlike original proposal — user preference: structural consistency over speed). Standard's draft therefore consumes outline the same way deep does.

### Degraded mode

If `thesis === null`, skip the "narrative arc" block — the existing styleGuide still applies, report is allowed to fall back to current Q-per-section shape.

## Downstream phase changes

### Critique prompt (deep)

Add these checks on top of existing AI-voice / thinness / hedging checks:

1. TL;DR first sentence paraphrases `central_claim`?
2. Each section's first sentence contains outline's Connection IN anchor?
3. Each section's last sentence contains Connection OUT hook (except final)?
4. Each section restates its assigned `sub_claim` at least once?
5. Final section has explicit "so what" (action / prediction / judgment)?

Critique output feeds revise unchanged. Critique receives `thesis` + `outline` in its input.

### Revise prompt (deep, standard)

Revise receives `thesis` + `outline` + critique + draft. No structural prompt change; the upstream critique already surfaces thesis-related issues.

### Editor prompt (deep, terminal)

Add "do NOT disturb narrative arc":
- Heading text unchanged
- Connector words (IN/OUT anchors) unchanged
- TL;DR opening unchanged

Editor retains responsibility for word compression, bolding reduction, banned-phrase removal.

### Quality loop (deep)

`reportQualityPrompt` scoring rubric adds: "thesis-execution failure" = automatic score ≤ 3 (one of: central_claim not present, no cross-section connectors, no so-what). Drives another critique→revise iteration.

## Cache + Retry

`PipelineCache` adds:

```ts
thesisOutput?: string;
thesisUsage?: TokenUsage;
thesisParsed?: ParsedThesis;  // structured, not re-parsed on retry
```

`index.ts` retry cache extractor identifies the thesis phase by `kind === "critique" && label === "Thesis"`.

Existing outline / draft / critique / revise cache fields remain. Revising prompts invalidates semantics across deployments but within a single retry is safe.

## Token & latency impact

| Mode     | Tokens (approx Δ)     | Wall clock Δ |
|----------|-----------------------|--------------|
| Standard | +~5k in / +~700 out (~+15%) | +15–25 s (adds thesis + outline phase) |
| Deep     | +~6k in / +~800 out (~+10%) | +10–20 s |

## Risks & open questions

1. **Enumeration-style goals** ("list top 10 X"): thesis phase forces a refutable judgment that may feel contrived. Mitigation: quality loop catches awkward thesis; fallback path exists (`thesis = null`) if parse fails.
2. **Prompt verbosity**: outline + draft prompts grow. Monitor cache-hit ratio on Hermes gateway.
3. **UI phase count**: deep has 9+ visible phases. Should be fine with current PipelineView; verify it still fits in one screen at 1440p.
4. **Translation fidelity**: `central_claim` in Chinese → English paraphrase in TL;DR. Prompt must make language mirror explicit.
5. **Critique feedback overload**: adding 5 new checks may drown out style checks. Plan: weight narrative-arc checks at roughly the same priority as existing AI-voice checks, not higher.

## Out of scope

- UI changes (PipelineView is flexible enough)
- Prompt-style refactor of research/plan prompts (they already use their own conventions)
- Multi-language thesis (English + Chinese hybrid reports) — single `language` setting still governs
- Interactive thesis editing by the user — thesis is fully automatic

## Verification plan

After implementation:

1. **Regression**: run an existing completed task in deep mode via retry. Observe: thesis phase appears; outline follows thesis.section_plan; draft TL;DR opens with central_claim paraphrase; sections have visible connectors.
2. **Enumeration-goal sanity check**: run "列出 2026-04-24 Hugging Face trending papers" in deep mode. Observe: thesis phase produces either a reasonable meta-claim ("研究圈本周聚焦 X") or returns null → report falls back cleanly.
3. **Standard mode**: run same goal in standard mode. Observe: thesis + outline phases present; final report uses section names instead of Q#.
4. **Cache retry**: interrupt a deep task after draft; retry. Observe: thesis + outline replay from cache, draft re-runs.
5. **Quality loop**: run a goal where the first draft likely misses the "so what" (e.g., neutral historical survey). Observe: quality loop catches it, triggers a revise pass.
6. **Token accounting**: compare usage of same goal pre/post change. Confirm ~+10–15% total, no runaway.

## File-level touch list

- `server/src/prompt.ts` — add `thesisPrompt`, modify `outlinePrompt`, append narrative-arc block to `draftPrompt` / `directReportPrompt` (standard), extend `critiquePrompt` + `reportQualityPrompt` + `editorPrompt`, add `parseThesis` helper.
- `server/src/runner.ts` — add `runThesis` phase, wire into both `runStandardMode` and `runDeepMode` after research (and adequacy gate, for deep); shift outline/draft/critique/revise/editor seq numbers by +1; extend `PipelineCache`.
- `server/src/index.ts` — extend retry cache extractor to capture Thesis phase into cache.
- `shared/types.ts` — add `ParsedThesis` type.
- No frontend changes required.
