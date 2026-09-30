// Fake credentials generated at test time from a seeded PRNG. Nothing here is a real key,
// and no complete secret literal appears in source (so neither GitHub push protection nor
// preflux itself flags this repository).

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const ALNUM = UPPER + LOWER + DIGITS;
const B64 = `${ALNUM}+/`;
const B64URL = `${ALNUM}_-`;

/** mulberry32: tiny deterministic PRNG so failures are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeFaker(seed = 42) {
  const rng = makeRng(seed);
  const chars = (n: number, alphabet: string) => {
    let s = "";
    for (let i = 0; i < n; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
    return s;
  };
  /** Random string guaranteed to mix upper, lower and digits (like real keys do). */
  const mixed = (n: number, alphabet = ALNUM) => `A${"b"}7${chars(n - 3, alphabet)}`;

  return {
    chars,
    awsAccessKeyId: () => `AK${"IA"}${chars(16, UPPER + DIGITS)}`,
    awsSecretAccessKey: () => mixed(40, B64),
    githubToken: () => `gh${"p_"}${chars(36, ALNUM)}`,
    githubFineGrained: () => `github${"_pat_"}${chars(82, `${ALNUM}_`)}`,
    gitlabToken: () => `gl${"pat-"}${chars(20, B64URL)}`,
    slackToken: () => `xo${"xb-"}${chars(12, DIGITS)}-${chars(24, ALNUM)}`,
    slackWebhook: () => `https://hooks.slack.com/${"services"}/T${chars(9, UPPER + DIGITS)}/B${chars(9, UPPER + DIGITS)}/${chars(24, ALNUM)}`,
    stripeKey: () => ["sk", "live", chars(24, ALNUM)].join("_"),
    googleApiKey: () => `AI${"za"}${chars(35, B64URL)}`,
    openaiKey: () => `sk-${"proj-"}${chars(24, B64URL)}T3Blbk${"FJ"}${chars(24, B64URL)}`,
    anthropicKey: () => `sk-${"ant-"}api03-${chars(90, B64URL)}`,
    sendgridKey: () => `SG${"."}${chars(22, B64URL)}.${chars(43, B64URL)}`,
    npmToken: () => `np${"m_"}${chars(36, ALNUM)}`,
    privateKeyHeader: () => `-----BEGIN RSA ${"PRIVATE"} KEY-----`,
    jwt: () => `ey${"J"}${chars(24, B64URL)}.ey${"J"}${chars(40, B64URL)}.${chars(43, B64URL)}`,
    dbPassword: () => mixed(18),
    highEntropy: () => mixed(40),
    hex: (n: number) => chars(n, "0123456789abcdef"),
  };
}
