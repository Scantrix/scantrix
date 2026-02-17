/**
 * AST-based Playwright config parser using the TypeScript Compiler API.
 *
 * This module parses playwright.config.ts/js using a real TypeScript AST instead
 * of regexes, handling:
 *   - Computed values: `60 * 1000`, `2 * 60 * 1000`
 *   - Spread operators: `...baseUse` (recorded as unknown)
 *   - Ternary expressions: `process.env.CI ? 2 : 0` (recorded as the raw source text)
 *   - Variable references within the same file
 *   - `satisfies` keyword (TS 4.9+)
 *   - Template literals (partial)
 *   - Array/object literals (recursed)
 *
 * Falls back gracefully when encountering unsupported patterns.
 */

import ts from "typescript";
import type { PlaywrightConfigSummary } from "./configExtractor";

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Parse a Playwright config file using the TypeScript compiler API.
 * Returns a structured PlaywrightConfigSummary, or undefined if parsing fails.
 */
export function parseConfigWithAst(
  filePath: string,
  sourceText: string,
): PlaywrightConfigSummary | undefined {
  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );

    // Build a simple scope of top-level `const x = ...` declarations
    const scope = buildFileScope(sourceFile);

    // Find the config object: `defineConfig({...})` or `export default {...}`
    const configNode = findConfigObject(sourceFile);
    if (!configNode) return undefined;

    const raw = evaluateObject(configNode, scope);
    if (!raw || typeof raw !== "object") return undefined;

    return mapToSummary(filePath, raw, scope);
  } catch {
    return undefined;
  }
}

// ─── Scope Building ──────────────────────────────────────────────────

type Scope = Map<string, ts.Expression>;

function buildFileScope(sourceFile: ts.SourceFile): Scope {
  const scope: Scope = new Map();

  for (const stmt of sourceFile.statements) {
    // const FOO = expr;
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          scope.set(decl.name.text, decl.initializer);
        }
      }
    }
  }
  return scope;
}

// ─── Config Object Finder ────────────────────────────────────────────

function findConfigObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  let result: ts.ObjectLiteralExpression | undefined;

  function visit(node: ts.Node): void {
    // defineConfig({ ... })
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineConfig" &&
      node.arguments.length >= 1
    ) {
      const arg = node.arguments[0];
      if (ts.isObjectLiteralExpression(arg)) {
        result = arg;
        return;
      }
    }

    // export default { ... }
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      let expr = node.expression;

      // Handle: export default { ... } satisfies PlaywrightTestConfig
      if (ts.isSatisfiesExpression?.(expr)) {
        expr = expr.expression;
      }
      // Handle: export default { ... } as PlaywrightTestConfig
      if (ts.isAsExpression(expr)) {
        expr = expr.expression;
      }

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

// ─── AST Evaluator ───────────────────────────────────────────────────
// Tries to evaluate AST nodes into plain JS values.
// Returns undefined for unevaluable nodes, or the raw source text as a string.

function evaluateNode(node: ts.Expression, scope: Scope): any {
  // Numeric literal
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }

  // String literal
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  // Boolean
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return undefined;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;

  // Identifier — look up in scope
  if (ts.isIdentifier(node)) {
    const ref = scope.get(node.text);
    if (ref) return evaluateNode(ref, scope);
    return `<ref:${node.text}>`;
  }

  // Binary expression (multiplication, addition)
  if (ts.isBinaryExpression(node)) {
    const left = evaluateNode(node.left, scope);
    const right = evaluateNode(node.right, scope);
    if (typeof left === "number" && typeof right === "number") {
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.AsteriskToken: return left * right;
        case ts.SyntaxKind.PlusToken: return left + right;
        case ts.SyntaxKind.MinusToken: return left - right;
        case ts.SyntaxKind.SlashToken: return right !== 0 ? left / right : undefined;
      }
    }
    // Logical OR for fallback patterns: `process.env.X || 'default'`
    if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      // Return the raw source expression as a string for display
      return node.getText();
    }
    // Return raw expression text
    return node.getText();
  }

  // Conditional (ternary) expression
  if (ts.isConditionalExpression(node)) {
    // We can't evaluate process.env.CI at parse time, so return the raw text
    return node.getText();
  }

  // Property access: process.env.CI, devices['Desktop Chrome']
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return node.getText();
  }

  // Prefix unary: !condition, -number
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = evaluateNode(node.operand, scope);
    if (node.operator === ts.SyntaxKind.ExclamationToken && typeof operand === "boolean") return !operand;
    if (node.operator === ts.SyntaxKind.MinusToken && typeof operand === "number") return -operand;
    return node.getText();
  }

  // Object literal
  if (ts.isObjectLiteralExpression(node)) {
    return evaluateObject(node, scope);
  }

  // Array literal
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((el) => evaluateNode(el, scope));
  }

  // Spread element
  if (ts.isSpreadElement(node)) {
    return { __spread: node.expression.getText() };
  }

  // Call expression: require.resolve('...'), etc.
  if (ts.isCallExpression(node)) {
    // Try to get the first string argument
    if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      return node.arguments[0].text;
    }
    return node.getText();
  }

  // Template expression: `${process.env.BASE_URL}/api`
  if (ts.isTemplateExpression(node)) {
    return node.getText();
  }

  // ParenthesizedExpression
  if (ts.isParenthesizedExpression(node)) {
    return evaluateNode(node.expression, scope);
  }

  // `satisfies` expression (TS 4.9+)
  if (ts.isSatisfiesExpression?.(node)) {
    return evaluateNode(node.expression, scope);
  }

  // `as` expression
  if (ts.isAsExpression(node)) {
    return evaluateNode(node.expression, scope);
  }

  // Fallback: raw text
  return node.getText();
}

function evaluateObject(
  node: ts.ObjectLiteralExpression,
  scope: Scope,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const prop of node.properties) {
    // Spread assignment: ...baseConfig
    if (ts.isSpreadAssignment(prop)) {
      result.__spreads = result.__spreads || [];
      result.__spreads.push(prop.expression.getText());
      continue;
    }

    if (ts.isPropertyAssignment(prop)) {
      const key = getPropertyName(prop);
      if (key) {
        result[key] = evaluateNode(prop.initializer, scope);
      }
    }

    // Shorthand property: { workers }
    if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text;
      const ref = scope.get(key);
      result[key] = ref ? evaluateNode(ref, scope) : `<ref:${key}>`;
    }

    // Method declaration: ignored (not typical in config)
  }

  return result;
}

function getPropertyName(prop: ts.PropertyAssignment): string | undefined {
  const name = prop.name;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return undefined; // can't evaluate
  return undefined;
}

// ─── Mapping to PlaywrightConfigSummary ──────────────────────────────

function asNumber(v: any): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function asString(v: any): string | undefined {
  if (typeof v === "string") return v;
  return undefined;
}

function mapToSummary(
  filePath: string,
  raw: Record<string, any>,
  scope: Scope,
): PlaywrightConfigSummary {
  const summary: PlaywrightConfigSummary = { configPath: filePath };

  summary.testDir = asString(raw.testDir);
  summary.timeoutMs = asNumber(raw.timeout);
  summary.workers = raw.workers !== undefined ? String(raw.workers) : undefined;
  summary.retries = raw.retries !== undefined ? String(raw.retries) : undefined;
  summary.globalSetup = asString(raw.globalSetup);

  // expect block
  if (raw.expect && typeof raw.expect === "object") {
    summary.expectTimeoutMs = asNumber(raw.expect.timeout);
  }

  // use block
  if (raw.use && typeof raw.use === "object") {
    const u = raw.use as Record<string, any>;
    summary.use = {
      headless: u.headless !== undefined ? String(u.headless) : undefined,
      actionTimeoutMs: asNumber(u.actionTimeout),
      trace: asString(u.trace),
      video: asString(u.video),
      screenshot: asString(u.screenshot),
      ignoreHTTPSErrors:
        u.ignoreHTTPSErrors === true ? true :
        u.ignoreHTTPSErrors === false ? false : undefined,
      baseURL: asString(u.baseURL),
    };

    // Parse launchOptions.args if present
    if (u.launchOptions && typeof u.launchOptions === "object" && Array.isArray(u.launchOptions.args)) {
      summary.use.launchArgs = u.launchOptions.args.filter(
        (a: any): a is string => typeof a === "string",
      );
    }
  }

  // reporters
  if (Array.isArray(raw.reporter)) {
    summary.reporters = raw.reporter
      .map((r: any) => {
        if (typeof r === "string") return { name: r };
        if (Array.isArray(r) && typeof r[0] === "string") {
          return { name: r[0], details: r[1] && typeof r[1] === "object" ? r[1] : undefined };
        }
        return undefined;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }

  // projects
  if (Array.isArray(raw.projects)) {
    summary.projects = raw.projects
      .map((p: any) => {
        if (!p || typeof p !== "object") return undefined;
        return {
          name: asString(p.name) ?? "unknown",
          grep: asString(p.grep),
          browserName: asString(p.browserName),
          isMobile: p.isMobile === true ? true : p.isMobile === false ? false : undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }

  // env hints — detect from raw source text patterns
  // (these are derived from text patterns, not AST; we keep them for compatibility)

  return summary;
}
