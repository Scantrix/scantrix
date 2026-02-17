/**
 * Cypress configuration extractor.
 *
 * Detects Cypress projects and parses their configuration from:
 *   - cypress.config.ts / cypress.config.js  (Cypress 10+)
 *   - cypress.json                            (Cypress <10, legacy)
 *
 * Also detects the Cypress directory structure (cypress/e2e, cypress/integration).
 */

import fs from "fs/promises";
import path from "path";
import ts from "typescript";

export type CypressConfigSummary = {
  configPath: string;
  configFormat: "ts" | "js" | "json";
  cypressVersion?: string;

  baseUrl?: string;
  specPattern?: string;
  defaultCommandTimeout?: number;
  requestTimeout?: number;
  responseTimeout?: number;
  pageLoadTimeout?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  video?: boolean;
  screenshotOnRunFailure?: boolean;

  retries?: {
    runMode?: number;
    openMode?: number;
  };

  testDir?: string;    // inferred from specPattern or directory structure
  testFileCount?: number;
};

export async function extractCypressConfig(
  repoPath: string,
): Promise<CypressConfigSummary | undefined> {
  // Priority order: TS > JS > JSON
  const candidates: Array<{ file: string; format: "ts" | "js" | "json" }> = [
    { file: "cypress.config.ts", format: "ts" },
    { file: "cypress.config.js", format: "js" },
    { file: "cypress.config.mjs", format: "js" },
    { file: "cypress.json", format: "json" },
  ];

  let configPath: string | undefined;
  let configFormat: "ts" | "js" | "json" = "ts";

  for (const c of candidates) {
    const full = path.join(repoPath, c.file);
    try {
      await fs.access(full);
      configPath = full;
      configFormat = c.format;
      break;
    } catch {
      // not found
    }
  }

  if (!configPath) {
    // Also check if cypress/ directory exists without config (very old projects)
    try {
      const cypressDir = path.join(repoPath, "cypress");
      const stat = await fs.stat(cypressDir);
      if (stat.isDirectory()) {
        return {
          configPath: cypressDir,
          configFormat: "json",
          testDir: "cypress",
        };
      }
    } catch {
      // no cypress directory either
    }
    return undefined;
  }

  const content = await fs.readFile(configPath, "utf8");

  if (configFormat === "json") {
    return parseJsonConfig(configPath, content);
  }

  return parseTsJsConfig(configPath, content, configFormat);
}

// ─── JSON Config (Cypress <10) ───────────────────────────────────────

function parseJsonConfig(
  configPath: string,
  content: string,
): CypressConfigSummary | undefined {
  try {
    const json = JSON.parse(content);
    return {
      configPath,
      configFormat: "json",
      baseUrl: json.baseUrl,
      defaultCommandTimeout: asNum(json.defaultCommandTimeout),
      requestTimeout: asNum(json.requestTimeout),
      responseTimeout: asNum(json.responseTimeout),
      pageLoadTimeout: asNum(json.pageLoadTimeout),
      viewportWidth: asNum(json.viewportWidth),
      viewportHeight: asNum(json.viewportHeight),
      video: asBool(json.video),
      screenshotOnRunFailure: asBool(json.screenshotOnRunFailure),
      retries: parseRetries(json.retries),
      testDir: json.integrationFolder ?? "cypress/integration",
    };
  } catch {
    return undefined;
  }
}

// ─── TS/JS Config (Cypress 10+) ─────────────────────────────────────

function parseTsJsConfig(
  configPath: string,
  content: string,
  format: "ts" | "js",
): CypressConfigSummary | undefined {
  try {
    const sourceFile = ts.createSourceFile(
      configPath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );

    const configObj = findDefineConfigOrDefault(sourceFile);
    if (!configObj) return undefined;

    const raw = evalObj(configObj);

    // Cypress 10+ configs nest most settings under `e2e:` or `component:`
    const e2e = raw.e2e ?? raw;

    return {
      configPath,
      configFormat: format,
      baseUrl: asStr(e2e.baseUrl),
      specPattern: asStr(e2e.specPattern),
      defaultCommandTimeout: asNum(e2e.defaultCommandTimeout),
      requestTimeout: asNum(e2e.requestTimeout),
      responseTimeout: asNum(e2e.responseTimeout),
      pageLoadTimeout: asNum(e2e.pageLoadTimeout),
      viewportWidth: asNum(e2e.viewportWidth ?? raw.viewportWidth),
      viewportHeight: asNum(e2e.viewportHeight ?? raw.viewportHeight),
      video: asBool(e2e.video ?? raw.video),
      screenshotOnRunFailure: asBool(e2e.screenshotOnRunFailure ?? raw.screenshotOnRunFailure),
      retries: parseRetries(e2e.retries ?? raw.retries),
      testDir: asStr(e2e.specPattern)
        ? path.dirname(asStr(e2e.specPattern)!.split("*")[0]) || "cypress/e2e"
        : "cypress/e2e",
    };
  } catch {
    return undefined;
  }
}

function findDefineConfigOrDefault(
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  let result: ts.ObjectLiteralExpression | undefined;

  function visit(node: ts.Node): void {
    if (result) return;

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineConfig" &&
      node.arguments.length >= 1 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      result = node.arguments[0] as ts.ObjectLiteralExpression;
      return;
    }

    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      let expr = node.expression;
      if (ts.isAsExpression(expr)) expr = expr.expression;
      if (ts.isObjectLiteralExpression(expr)) {
        result = expr;
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

// ─── Lightweight AST evaluator ───────────────────────────────────────

function evalNode(node: ts.Expression): any {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isObjectLiteralExpression(node)) return evalObj(node);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evalNode);
  if (ts.isBinaryExpression(node)) {
    const l = evalNode(node.left);
    const r = evalNode(node.right);
    if (typeof l === "number" && typeof r === "number") {
      if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return l * r;
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return l + r;
    }
    return node.getText();
  }
  if (ts.isConditionalExpression(node)) return node.getText();
  if (ts.isPropertyAccessExpression(node)) return node.getText();
  if (ts.isParenthesizedExpression(node)) return evalNode(node.expression);
  return node.getText();
}

function evalObj(node: ts.ObjectLiteralExpression): Record<string, any> {
  const result: Record<string, any> = {};
  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      result[prop.name.text] = evalNode(prop.initializer);
    }
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function asNum(v: any): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function asStr(v: any): string | undefined {
  if (typeof v === "string") return v;
  return undefined;
}

function asBool(v: any): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function parseRetries(v: any): CypressConfigSummary["retries"] | undefined {
  if (typeof v === "number") return { runMode: v, openMode: 0 };
  if (v && typeof v === "object") {
    return {
      runMode: asNum(v.runMode),
      openMode: asNum(v.openMode),
    };
  }
  return undefined;
}
