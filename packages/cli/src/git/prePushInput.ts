// Git feeds the pre-push hook one line per ref being pushed:
//   <local ref> SP <local sha> SP <remote ref> SP <remote sha> LF
// See `git help githooks` (pre-push).

export interface PushedRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

const ZERO_SHA = /^0+$/;

export function isZeroSha(sha: string): boolean {
  return ZERO_SHA.test(sha);
}

export function parsePrePushInput(input: string): PushedRef[] {
  const refs: PushedRef[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 4) {
      throw new Error(`Unexpected pre-push input line: "${line}"`);
    }
    const [localRef, localSha, remoteRef, remoteSha] = parts as [string, string, string, string];
    refs.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return refs;
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
