import type { Severity } from "@preflux/shared";

export interface SecretPattern {
  id: string;
  description: string;
  severity: Severity;
  /** Must be global. If the regex has a capture group 1, that group is the secret; otherwise the whole match. */
  regex: RegExp;
}

// Known credential formats. Sources: provider docs and Gitleaks' default rules.
// Regexes are anchored on vendor prefixes to stay precise; the entropy detector covers unknown formats.
export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "aws-access-key-id",
    description: "AWS access key ID",
    severity: "critical",
    regex: /\b((?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16})\b/g,
  },
  {
    id: "aws-secret-access-key",
    description: "AWS secret access key",
    severity: "critical",
    regex: /aws.{0,20}?(?:secret|private).{0,20}?[=:]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
  },
  {
    id: "github-token",
    description: "GitHub personal access / OAuth / app token",
    severity: "critical",
    regex: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g,
  },
  {
    id: "github-fine-grained-pat",
    description: "GitHub fine-grained personal access token",
    severity: "critical",
    regex: /\b(github_pat_[A-Za-z0-9_]{82})\b/g,
  },
  {
    id: "gitlab-pat",
    description: "GitLab personal access token",
    severity: "critical",
    regex: /\b(glpat-[A-Za-z0-9_-]{20})\b/g,
  },
  {
    id: "slack-token",
    description: "Slack token",
    severity: "high",
    regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  },
  {
    id: "slack-webhook",
    description: "Slack incoming webhook URL",
    severity: "high",
    regex: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,})/g,
  },
  {
    id: "stripe-key",
    description: "Stripe secret or restricted key",
    severity: "critical",
    regex: /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,})\b/g,
  },
  {
    id: "google-api-key",
    description: "Google API key",
    severity: "high",
    regex: /\b(AIza[0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])/g,
  },
  {
    id: "openai-api-key",
    description: "OpenAI API key",
    severity: "critical",
    regex: /\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,})(?![A-Za-z0-9_-])/g,
  },
  {
    id: "anthropic-api-key",
    description: "Anthropic API key",
    severity: "critical",
    regex: /\b(sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,})(?![A-Za-z0-9_-])/g,
  },
  {
    id: "sendgrid-api-key",
    description: "SendGrid API key",
    severity: "high",
    regex: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g,
  },
  {
    id: "npm-token",
    description: "npm access token",
    severity: "critical",
    regex: /\b(npm_[A-Za-z0-9]{36})\b/g,
  },
  {
    id: "private-key",
    description: "Private key block",
    severity: "critical",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    id: "jwt",
    description: "JSON Web Token (may be a Supabase service key or a session token)",
    severity: "high",
    regex: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})(?![A-Za-z0-9_-])/g,
  },
  {
    id: "db-connection-string",
    description: "Database connection string with an embedded password",
    severity: "critical",
    regex: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql):\/\/[^\s:@/"'`]+:([^\s@/"'`]+)@[^\s"'`]+/gi,
  },
];

/**
 * A secret-looking keyword assigned a string literal, e.g. `password = "..."` or `"apiKey": "..."`.
 * Group 1 is the value. The scanner applies a lower entropy threshold here because the keyword adds context.
 */
export const KEYWORD_ASSIGNMENT =
  /(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth[_-]?key|client[_-]?secret|private[_-]?key|credentials?)["']?\s*(?::=|=>|:|=)\s*["'`]([^"'`\s]{8,})["'`]/gi;
