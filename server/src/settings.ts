import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ModelRouting, TaskTemplate, EmbeddingSettings } from "../../shared/types.ts";
import { DEFAULT_MODEL_ROUTING } from "../../shared/types.ts";

const SETTINGS_PATH = join(homedir(), ".hermes-dashboard", "settings.json");

interface Settings {
  modelRouting: ModelRouting;
  embedding: EmbeddingSettings;
  templates: TaskTemplate[];
}

function defaults(): Settings {
  return {
    modelRouting: { ...DEFAULT_MODEL_ROUTING },
    embedding: { provider: "openai", endpoint: "", apiKey: "", model: "", dimensions: 0 },
    templates: [],
  };
}

let _cache: Settings | null = null;

export function loadSettings(): Settings {
  if (_cache) return _cache;
  if (!existsSync(SETTINGS_PATH)) {
    _cache = defaults();
    return _cache;
  }
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    _cache = { ...defaults(), ...parsed };
    return _cache!;
  } catch {
    _cache = defaults();
    return _cache;
  }
}

export function saveSettings(partial: Partial<Settings>): Settings {
  const current = loadSettings();
  const next = { ...current, ...partial };
  _cache = next;
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function getModelForPhase(phase: string): string | undefined {
  const routing = loadSettings().modelRouting;
  const model = (routing as unknown as Record<string, string>)[phase];
  return model || undefined;
}

// Template helpers
export function getTemplates(): TaskTemplate[] {
  return loadSettings().templates;
}

export function addTemplate(tpl: TaskTemplate): TaskTemplate {
  const settings = loadSettings();
  settings.templates.push(tpl);
  saveSettings(settings);
  return tpl;
}

export function deleteTemplate(id: string): void {
  const settings = loadSettings();
  settings.templates = settings.templates.filter((t) => t.id !== id);
  saveSettings(settings);
}
