/** Show just enough of a secret to recognise it, e.g. "ghp_********(40 chars)". */
export function maskSecret(secret: string): string {
  const visible = secret.length >= 16 ? 4 : secret.length >= 8 ? 2 : 0;
  return `${secret.slice(0, visible)}${"*".repeat(Math.min(8, secret.length - visible))}(${secret.length} chars)`;
}

const MAX_SNIPPET = 160;

/** The line with every secret replaced by its mask, trimmed and truncated. Safe to print or upload. */
export function maskLine(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join(maskSecret(s));
  out = out.trim();
  return out.length > MAX_SNIPPET ? `${out.slice(0, MAX_SNIPPET)}…` : out;
}
