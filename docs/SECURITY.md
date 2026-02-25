# Security Notes

This document covers security considerations for the Scantrix tool and audited repositories.

## What the Audit Detects

### Hardcoded Credentials (ARCH-005)
The scanner detects hardcoded passwords, API keys, and tokens in test files:
- Passwords in string literals (e.g., `const password = 'Secret123!'`)
- Bearer tokens and API keys
- Phone numbers used as identifiers

**Recommendation:** Use environment variables or secret management tools. Never commit credentials to source control.

### Hardcoded Email Addresses (ARCH-005a)
Test files with hardcoded email addresses create collisions in shared test environments and leak organizational information.

**Recommendation:** Use faker libraries or data factories to generate unique test data.

## Security of the Audit Tool Itself

### File Access
- The audit tool only **reads** files. It never modifies the scanned repository.
- File access is limited to paths under the provided `--repo` directory.
- The tool uses `fast-glob` for file discovery with no symbolic link following by default.

### Output Security
- Audit reports may contain snippets of source code from the scanned repository.
- **Do not share audit reports of private repositories** without reviewing the evidence sections.
- The `findings.json` contains file paths and code snippets that could reveal internal project structure.

### SARIF Output
- SARIF files are designed for upload to GitHub Code Scanning or Azure DevOps.
- Ensure your CI pipeline handles SARIF files with appropriate access controls.
- SARIF output includes relative file paths, not absolute paths.

### .auditrc.json
- The `.auditrc.json` config file can disable rules. Ensure it is version-controlled and changes are reviewed.
- Disabling security-related rules (ARCH-005, ARCH-005a) should require team approval.

## OWASP Relevance

While this tool focuses on automation framework quality, several findings overlap with OWASP concerns:

| Finding | OWASP Category |
|---------|---------------|
| ARCH-005 (Hardcoded credentials) | A07:2021 – Identification and Auth Failures |
| ARCH-005a (Hardcoded emails) | A01:2021 – Broken Access Control |
| CI-011 (Missing playwright install) | A05:2021 – Security Misconfiguration |
| PW-PERF-002 (Hardcoded URLs) | A05:2021 – Security Misconfiguration |

## Reporting Security Issues

If you discover a security vulnerability in the audit tool itself, please report it privately to the maintainers rather than opening a public issue.
