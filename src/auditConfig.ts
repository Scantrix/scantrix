import fs from "fs/promises";
import path from "path";

/**
 * User-facing configuration for customizing audit behavior.
 * Loaded from `.auditrc.json` in the target repo or via --config CLI flag.
 */
export type AuditConfig = {
  /** Rule-level overrides */
  rules?: {
    /** Finding IDs to suppress entirely (e.g. ["PW-LOC-001", "ARCH-006"]) */
    disabled?: string[];
    /** Override default severity for specific findings */
    severityOverrides?: Record<string, "low" | "medium" | "high">;
  };
  /** Glob patterns to exclude from scanning (applied to all file searches) */
  exclude?: string[];
  /** Override risk-score grade thresholds */
  thresholds?: {
    gradeA?: number;
    gradeB?: number;
    gradeC?: number;
  };
};

const DEFAULT_CONFIG: AuditConfig = {
  rules: { disabled: [], severityOverrides: {} },
  exclude: [],
  thresholds: { gradeA: 20, gradeB: 50, gradeC: 85 },
};

export async function loadAuditConfig(
  repoPath: string,
  explicitPath?: string
): Promise<AuditConfig> {
  const configPath = explicitPath
    ? path.resolve(explicitPath)
    : path.join(repoPath, ".auditrc.json");

  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function mergeConfig(
  defaults: AuditConfig,
  overrides: Partial<AuditConfig>
): AuditConfig {
  return {
    rules: {
      disabled: overrides.rules?.disabled ?? defaults.rules?.disabled ?? [],
      severityOverrides: {
        ...(defaults.rules?.severityOverrides ?? {}),
        ...(overrides.rules?.severityOverrides ?? {}),
      },
    },
    exclude: overrides.exclude ?? defaults.exclude ?? [],
    thresholds: {
      gradeA: overrides.thresholds?.gradeA ?? defaults.thresholds?.gradeA ?? 20,
      gradeB: overrides.thresholds?.gradeB ?? defaults.thresholds?.gradeB ?? 50,
      gradeC: overrides.thresholds?.gradeC ?? defaults.thresholds?.gradeC ?? 85,
    },
  };
}

export function isRuleDisabled(config: AuditConfig, ruleId: string): boolean {
  return config.rules?.disabled?.includes(ruleId) ?? false;
}

export function getEffectiveSeverity(
  config: AuditConfig,
  ruleId: string,
  defaultSeverity: "low" | "medium" | "high"
): "low" | "medium" | "high" {
  return config.rules?.severityOverrides?.[ruleId] ?? defaultSeverity;
}

/**
 * Generate a well-documented starter .auditrc.json with all options commented.
 */
export function generateDefaultConfig(): string {
  const config = {
    "$schema": "https://scantrix.com/schemas/auditrc.json",
    "rules": {
      "disabled": [] as string[],
      "severityOverrides": {} as Record<string, string>,
    },
    "exclude": [
      "node_modules/**",
      "dist/**",
      "coverage/**",
    ],
    "thresholds": {
      "gradeA": 20,
      "gradeB": 50,
      "gradeC": 85,
    },
    "_comments": {
      "disabled": "Add finding IDs to suppress entirely, e.g. [\"PW-LOC-001\", \"ARCH-006\"]",
      "severityOverrides": "Override severity for specific findings, e.g. { \"PW-FLAKE-001\": \"medium\" }",
      "exclude": "Glob patterns to exclude from file scanning",
      "thresholds": "Risk score thresholds for letter grades. gradeA=max score for A, gradeB=max for B, gradeC=max for C, above C = D/F",
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}
