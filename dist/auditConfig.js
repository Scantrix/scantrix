"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAuditConfig = loadAuditConfig;
exports.isRuleDisabled = isRuleDisabled;
exports.getEffectiveSeverity = getEffectiveSeverity;
exports.generateDefaultConfig = generateDefaultConfig;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const DEFAULT_CONFIG = {
    rules: { disabled: [], severityOverrides: {} },
    exclude: [],
    thresholds: { gradeA: 20, gradeB: 50, gradeC: 85 },
};
async function loadAuditConfig(repoPath, explicitPath) {
    const configPath = explicitPath
        ? path_1.default.resolve(explicitPath)
        : path_1.default.join(repoPath, ".auditrc.json");
    try {
        const raw = await promises_1.default.readFile(configPath, "utf8");
        const parsed = JSON.parse(raw);
        return mergeConfig(DEFAULT_CONFIG, parsed);
    }
    catch {
        return { ...DEFAULT_CONFIG };
    }
}
function mergeConfig(defaults, overrides) {
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
function isRuleDisabled(config, ruleId) {
    return config.rules?.disabled?.includes(ruleId) ?? false;
}
function getEffectiveSeverity(config, ruleId, defaultSeverity) {
    return config.rules?.severityOverrides?.[ruleId] ?? defaultSeverity;
}
/**
 * Generate a well-documented starter .auditrc.json with all options commented.
 */
function generateDefaultConfig() {
    const config = {
        "$schema": "https://qaverity.com/schemas/auditrc.json",
        "rules": {
            "disabled": [],
            "severityOverrides": {},
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
