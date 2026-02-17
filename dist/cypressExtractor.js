"use strict";
/**
 * Cypress configuration extractor.
 *
 * Detects Cypress projects and parses their configuration from:
 *   - cypress.config.ts / cypress.config.js  (Cypress 10+)
 *   - cypress.json                            (Cypress <10, legacy)
 *
 * Also detects the Cypress directory structure (cypress/e2e, cypress/integration).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCypressConfig = extractCypressConfig;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const typescript_1 = __importDefault(require("typescript"));
async function extractCypressConfig(repoPath) {
    // Priority order: TS > JS > JSON
    const candidates = [
        { file: "cypress.config.ts", format: "ts" },
        { file: "cypress.config.js", format: "js" },
        { file: "cypress.config.mjs", format: "js" },
        { file: "cypress.json", format: "json" },
    ];
    let configPath;
    let configFormat = "ts";
    for (const c of candidates) {
        const full = path_1.default.join(repoPath, c.file);
        try {
            await promises_1.default.access(full);
            configPath = full;
            configFormat = c.format;
            break;
        }
        catch {
            // not found
        }
    }
    if (!configPath) {
        // Also check if cypress/ directory exists without config (very old projects)
        try {
            const cypressDir = path_1.default.join(repoPath, "cypress");
            const stat = await promises_1.default.stat(cypressDir);
            if (stat.isDirectory()) {
                return {
                    configPath: cypressDir,
                    configFormat: "json",
                    testDir: "cypress",
                };
            }
        }
        catch {
            // no cypress directory either
        }
        return undefined;
    }
    const content = await promises_1.default.readFile(configPath, "utf8");
    if (configFormat === "json") {
        return parseJsonConfig(configPath, content);
    }
    return parseTsJsConfig(configPath, content, configFormat);
}
// ─── JSON Config (Cypress <10) ───────────────────────────────────────
function parseJsonConfig(configPath, content) {
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
    }
    catch {
        return undefined;
    }
}
// ─── TS/JS Config (Cypress 10+) ─────────────────────────────────────
function parseTsJsConfig(configPath, content, format) {
    try {
        const sourceFile = typescript_1.default.createSourceFile(configPath, content, typescript_1.default.ScriptTarget.Latest, true);
        const configObj = findDefineConfigOrDefault(sourceFile);
        if (!configObj)
            return undefined;
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
                ? path_1.default.dirname(asStr(e2e.specPattern).split("*")[0]) || "cypress/e2e"
                : "cypress/e2e",
        };
    }
    catch {
        return undefined;
    }
}
function findDefineConfigOrDefault(sourceFile) {
    let result;
    function visit(node) {
        if (result)
            return;
        if (typescript_1.default.isCallExpression(node) &&
            typescript_1.default.isIdentifier(node.expression) &&
            node.expression.text === "defineConfig" &&
            node.arguments.length >= 1 &&
            typescript_1.default.isObjectLiteralExpression(node.arguments[0])) {
            result = node.arguments[0];
            return;
        }
        if (typescript_1.default.isExportAssignment(node) && !node.isExportEquals) {
            let expr = node.expression;
            if (typescript_1.default.isAsExpression(expr))
                expr = expr.expression;
            if (typescript_1.default.isObjectLiteralExpression(expr)) {
                result = expr;
                return;
            }
        }
        typescript_1.default.forEachChild(node, visit);
    }
    visit(sourceFile);
    return result;
}
// ─── Lightweight AST evaluator ───────────────────────────────────────
function evalNode(node) {
    if (typescript_1.default.isNumericLiteral(node))
        return Number(node.text);
    if (typescript_1.default.isStringLiteral(node))
        return node.text;
    if (node.kind === typescript_1.default.SyntaxKind.TrueKeyword)
        return true;
    if (node.kind === typescript_1.default.SyntaxKind.FalseKeyword)
        return false;
    if (typescript_1.default.isObjectLiteralExpression(node))
        return evalObj(node);
    if (typescript_1.default.isArrayLiteralExpression(node))
        return node.elements.map(evalNode);
    if (typescript_1.default.isBinaryExpression(node)) {
        const l = evalNode(node.left);
        const r = evalNode(node.right);
        if (typeof l === "number" && typeof r === "number") {
            if (node.operatorToken.kind === typescript_1.default.SyntaxKind.AsteriskToken)
                return l * r;
            if (node.operatorToken.kind === typescript_1.default.SyntaxKind.PlusToken)
                return l + r;
        }
        return node.getText();
    }
    if (typescript_1.default.isConditionalExpression(node))
        return node.getText();
    if (typescript_1.default.isPropertyAccessExpression(node))
        return node.getText();
    if (typescript_1.default.isParenthesizedExpression(node))
        return evalNode(node.expression);
    return node.getText();
}
function evalObj(node) {
    const result = {};
    for (const prop of node.properties) {
        if (typescript_1.default.isPropertyAssignment(prop) && typescript_1.default.isIdentifier(prop.name)) {
            result[prop.name.text] = evalNode(prop.initializer);
        }
    }
    return result;
}
// ─── Helpers ─────────────────────────────────────────────────────────
function asNum(v) {
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    return undefined;
}
function asStr(v) {
    if (typeof v === "string")
        return v;
    return undefined;
}
function asBool(v) {
    if (typeof v === "boolean")
        return v;
    return undefined;
}
function parseRetries(v) {
    if (typeof v === "number")
        return { runMode: v, openMode: 0 };
    if (v && typeof v === "object") {
        return {
            runMode: asNum(v.runMode),
            openMode: asNum(v.openMode),
        };
    }
    return undefined;
}
