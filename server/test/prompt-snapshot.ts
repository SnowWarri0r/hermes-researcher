/* eslint-disable no-console */
/**
 * Snapshot test harness for prompt assembly.
 *
 * What this catches:
 *  - Accidental prompt size regressions (added a 2KB block without realising)
 *  - Structural changes that affect downstream behaviour
 *  - Surface bloat: a fixed input + assembly produces a fixed output, so any
 *    diff is a meaningful signal of intentional vs unintentional change
 *
 * Usage:
 *   pnpm exec tsx test/prompt-snapshot.ts             # check vs committed snapshots
 *   pnpm exec tsx test/prompt-snapshot.ts --update    # write current as new snapshot
 *
 * Each fixture exercises a different prompt-assembly path. The fixtures are
 * intentionally small — the goal isn't to stress-test, it's to give a stable
 * surface that any prompt edit visibly diffs against.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  planPrompt,
  thesisPrompt,
  outlinePrompt,
  draftPrompt,
  critiqueInstructionPrompt,
  reviseInstructionPrompt,
  editorPrompt,
  claimAuditPrompt,
  reportQualityPrompt,
  researchPrompt,
} from "../src/prompt.ts";
import type { Plan, ParsedThesis } from "../../shared/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(__dirname, "snapshots");

// ─── fixtures ──────────────────────────────────────────────────────────────

const fixtureGoal =
  "调研一下 Sony A7M5 同等价位相机，性价比最高，参数最好，最适合在 live 等暗光抓拍人像。";

const fixturePlan: Plan = {
  perspectives: [
    {
      id: "P1",
      name: "live 摄影爱好者",
      wants: "暗光下能不能锁脸、ISO 3200 噪点表现、连拍跟焦命中率",
    },
    {
      id: "P2",
      name: "退坑卖二手用户",
      wants: "三年后机身保值率、镜头转接生态",
    },
  ],
  sections: ["TL;DR", "暗光性能", "对比同价位", "二手与镜头"],
  questions: [
    {
      id: "Q1",
      title: "A7M5 在 ISO 3200/6400 的噪点和动态范围",
      approach: "DPReview + Photons-to-Photos studio scene + B&H 测评",
      serves: ["P1"],
    },
    {
      id: "Q2",
      title: "A7M5 vs Z6III vs R6 II 对比",
      approach: "三家官方规格 + 独立评测",
      serves: ["P1", "P2"],
    },
  ],
};

const fixtureThesis: ParsedThesis = {
  central_claim:
    "在 2026-04 同价位机身里，Z6III 暗光抓拍胜出，A7M5 仅在镜头生态上保留优势。",
  sub_claims: [
    {
      id: "C1",
      text: "Z6III 6K 60p oversampled 提供更干净的高 ISO 视频底",
      evidence_from: ["Q1"],
    },
    {
      id: "C2",
      text: "A7M5 的镜头集合在 2026-04 二手保值率上仍领先",
      evidence_from: ["Q2"],
    },
  ],
  section_plan: [
    { section: "TL;DR", sub_claim: null, role: "central claim opener" },
    { section: "暗光性能", sub_claim: "C1", role: "evidence + narrative" },
    {
      section: "对比同价位",
      sub_claim: "C2",
      role: "comparative table + judgment",
    },
    {
      section: "二手与镜头",
      sub_claim: null,
      role: "so-what + recommendation",
    },
  ],
};

const fixtureFindings = [
  {
    questionId: "Q1",
    title: "A7M5 ISO 表现",
    output: `
DPReview studio scene shows A7M5 ISO 3200 luminance noise +0.3 stops vs A7IV
([DPReview](https://www.dpreview.com/products/sony/slrs/sony_a7m5)).
Photons-to-Photos PDR at base ISO is 11.4 EV
([P2P chart](https://www.photonstophotos.net/Charts/PDR.htm)).

B&H reviewer noted: "tracking on backlit faces drops at ISO 6400, the
detection box flickers" ([B&H review](https://www.bhphotovideo.com/explora/photography/hands-on-review/sony-a7m5)).
`.trim(),
  },
  {
    questionId: "Q2",
    title: "Z6III vs R6II 同价位对比",
    output: `
Nikon Z6III 24MP partially-stacked sensor, 1/250s readout
([Nikon press](https://www.nikonusa.com/press-room/nikon-z6iii)).

R6II 24MP non-stacked, 1/63s readout — slower for fast subjects
([Canon spec](https://www.usa.canon.com/cameras/eos-r6-mark-ii/spec)).

Reddit r/photography thread on A7M5 镜头 selection: most quoted is
the 35mm f/1.8 G as the workhorse for live abstract shots
([Reddit](https://www.reddit.com/r/sonyalpha/comments/abc123)).
`.trim(),
  },
];

// ─── prompts to snapshot ───────────────────────────────────────────────────

const cases: { name: string; build: () => string }[] = [
  {
    name: "01_planPrompt",
    build: () =>
      planPrompt({
        goal: fixtureGoal,
        context: "",
        toolsets: ["websearch", "scrape"],
        language: "Chinese (简体中文)",
      }),
  },
  {
    name: "02_thesisPrompt_with_perspectives",
    build: () =>
      thesisPrompt({
        goal: fixtureGoal,
        planSections: fixturePlan.sections,
        findings: fixtureFindings,
        perspectives: fixturePlan.perspectives,
        language: "Chinese (简体中文)",
      }),
  },
  {
    name: "03_outlinePrompt_with_thesis",
    build: () =>
      outlinePrompt({
        goal: fixtureGoal,
        plan: fixturePlan,
        findings: fixtureFindings,
        thesis: fixtureThesis,
        language: "Chinese (简体中文)",
      }),
  },
  {
    name: "04_outlinePrompt_no_thesis",
    build: () =>
      outlinePrompt({
        goal: fixtureGoal,
        plan: fixturePlan,
        findings: fixtureFindings,
        thesis: null,
        language: "Chinese (简体中文)",
      }),
  },
  {
    name: "05_draftPrompt_full",
    build: () =>
      draftPrompt({
        goal: fixtureGoal,
        context: "",
        plan: fixturePlan,
        findings: fixtureFindings,
        outline: '{"sections":[{"name":"TL;DR","key_facts":[]}]}',
        thesis: fixtureThesis,
        language: "Chinese (简体中文)",
      }),
  },
  {
    name: "06_critiqueInstructionPrompt",
    build: () =>
      critiqueInstructionPrompt({
        goal: fixtureGoal,
        thesis: fixtureThesis,
        outline: '{"sections":[]}',
      }),
  },
  {
    name: "07_reviseInstructionPrompt_with_audit",
    build: () =>
      reviseInstructionPrompt({
        goal: fixtureGoal,
        toolsets: ["websearch"],
        language: "Chinese (简体中文)",
        thesis: fixtureThesis,
        outline: '{"sections":[]}',
        unsupportedClaims: [
          {
            section: "TL;DR",
            sentence: "Z6III 在暗光抓拍上压过 A7M5。",
            issue: "war-metaphor + no number",
          },
          {
            section: "对比同价位",
            sentence: "A7M5 镜头生态领先。",
            issue: "vague claim no source",
          },
        ],
      }),
  },
  {
    name: "08_editorPrompt_polish",
    build: () =>
      editorPrompt({
        goal: fixtureGoal,
        language: "Chinese (简体中文)",
        thesisPresent: true,
      }),
  },
  {
    name: "09_claimAuditPrompt",
    build: () =>
      claimAuditPrompt({
        goal: fixtureGoal,
        report: "## TL;DR\nZ6III 暗光好。\n\n## 暗光性能\nA7M5 ISO 3200 不错。",
        findings: fixtureFindings.map((f) => ({
          questionId: f.questionId,
          title: f.title,
        })),
        language: "Chinese (简体中文)",
      }),
  },
  {
    name: "10_reportQualityPrompt",
    build: () =>
      reportQualityPrompt({
        goal: fixtureGoal,
        report: "## TL;DR\n短报告，无数字无来源。",
        thesis: fixtureThesis,
      }),
  },
  {
    name: "11_researchPrompt_no_prereq",
    build: () =>
      researchPrompt({
        goal: fixtureGoal,
        question: fixturePlan.questions[0],
        context: "",
      }),
  },
  {
    name: "12_researchPrompt_with_prereq",
    build: () =>
      researchPrompt({
        goal: fixtureGoal,
        question: fixturePlan.questions[1],
        context: "",
        prerequisites: [
          {
            id: "Q1",
            title: "A7M5 ISO 表现",
            output: fixtureFindings[0].output,
          },
        ],
      }),
  },
];

// ─── runner ────────────────────────────────────────────────────────────────

const update = process.argv.includes("--update");

interface CaseResult {
  name: string;
  size: number;
  ok: boolean;
  diff?: string;
}

const results: CaseResult[] = [];
let bytesTotal = 0;

for (const c of cases) {
  const out = c.build();
  bytesTotal += out.length;
  const path = join(SNAP_DIR, `${c.name}.txt`);
  if (update) {
    writeFileSync(path, out, "utf-8");
    results.push({ name: c.name, size: out.length, ok: true });
    continue;
  }
  if (!existsSync(path)) {
    writeFileSync(path, out, "utf-8");
    results.push({ name: c.name, size: out.length, ok: true });
    continue;
  }
  const expected = readFileSync(path, "utf-8");
  if (expected === out) {
    results.push({ name: c.name, size: out.length, ok: true });
  } else {
    results.push({
      name: c.name,
      size: out.length,
      ok: false,
      diff: simpleDiff(expected, out),
    });
  }
}

// ─── reporting ─────────────────────────────────────────────────────────────

function simpleDiff(a: string, b: string): string {
  // Cheap line-level diff. Good enough for prompt-text snapshots.
  const al = a.split("\n");
  const bl = b.split("\n");
  const max = Math.max(al.length, bl.length);
  const lines: string[] = [];
  let shown = 0;
  for (let i = 0; i < max && shown < 30; i++) {
    if (al[i] !== bl[i]) {
      if (al[i] !== undefined) lines.push(`  - L${i + 1}: ${al[i]}`);
      if (bl[i] !== undefined) lines.push(`  + L${i + 1}: ${bl[i]}`);
      shown++;
    }
  }
  if (shown >= 30) lines.push(`  … (${max - shown} more diff lines)`);
  return lines.join("\n");
}

function formatBytes(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${n}B`;
}

let failed = 0;
console.log("=== prompt snapshot ===");
for (const r of results) {
  const status = r.ok ? "✓" : "✗";
  console.log(`  ${status} ${r.name.padEnd(45)} ${formatBytes(r.size).padStart(8)}`);
  if (!r.ok) {
    failed++;
    console.log(r.diff);
  }
}
console.log(`---`);
console.log(`total: ${results.length} cases, ${formatBytes(bytesTotal)} assembled output`);

if (update) {
  console.log("snapshots updated.");
} else if (failed > 0) {
  console.log(`✗ ${failed} snapshot(s) drifted. Review the diff above; if intentional, run with --update.`);

  // Don't fail in CI yet — just signal. User can wire to exit code later.
  // Set non-zero exit so a future CI hook can pick it up.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as unknown as { exitCode: number }).exitCode = 1;
} else {
  console.log("✓ all snapshots match.");
}

// Stale snapshot detector — files in SNAP_DIR not produced by current cases.
const expectedFiles = new Set(cases.map((c) => `${c.name}.txt`));
if (!update && existsSync(SNAP_DIR)) {
  const stale = readdirSync(SNAP_DIR).filter(
    (f) => f.endsWith(".txt") && !expectedFiles.has(f),
  );
  if (stale.length > 0) {
    console.log(`! stale snapshot files (no matching case): ${stale.join(", ")}`);
  }
}
