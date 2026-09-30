/** Shannon entropy in bits per character: H = -sum(p_i * log2(p_i)). */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export type Charset = "hex" | "base64";

const HEX = /^[0-9a-fA-F]+$/;

export function charsetOf(token: string): Charset {
  return HEX.test(token) ? "hex" : "base64";
}

// Runs of base64 / base64url characters (hex is a subset). Everything else is a delimiter.
const TOKEN = /[A-Za-z0-9+/=_-]+/g;

/** Candidate tokens on a line that are long enough to be worth measuring. */
export function candidateTokens(text: string, minLength: number): string[] {
  const tokens: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    // Trim leading/trailing separators and padding so "abc==" and "abc" measure the same.
    const token = m[0].replace(/^[-_/+=]+|[-_/+=]+$/g, "");
    if (token.length >= minLength) tokens.push(token);
  }
  return tokens;
}

/** Random keys mix character classes; identifiers, paths and prose usually don't. */
export function looksRandom(token: string): boolean {
  return /\d/.test(token) && /[a-z]/.test(token) && /[A-Z]/.test(token);
}
