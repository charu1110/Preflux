import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SCORE_CONFIG, type ScoreConfig } from "@preflux/shared";

export interface EntropyConfig {
  /** Bits/char above which an unexplained base64 token is flagged. */
  base64Threshold: number;
  /** Bits/char above which a hex token next to a secret-ish keyword is flagged. */
  hexThreshold: number;
  /** Bits/char for values assigned to keywords like `password` / `apiKey`. */
  keywordThreshold: number;
  minLength: number;
}

export interface PrefluxConfig {
  secrets: {
    entropy: EntropyConfig;
    /** Extra globs to skip, on top of .prefluxignore and the built-in lockfile list. */
    ignorePaths: string[];
  };
  score: ScoreConfig;
}

export const CONFIG_FILE = ".prefluxrc.json";

export const DEFAULT_CONFIG: PrefluxConfig = {
  secrets: {
    entropy: { base64Threshold: 4.5, hexThreshold: 3.0, keywordThreshold: 3.0, minLength: 20 },
    ignorePaths: [],
  },
  score: DEFAULT_SCORE_CONFIG,
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function loadConfig(root: string): PrefluxConfig {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return DEFAULT_CONFIG;
  let user: DeepPartial<PrefluxConfig>;
  try {
    user = JSON.parse(readFileSync(file, "utf8")) as DeepPartial<PrefluxConfig>;
  } catch (err) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${(err as Error).message}`);
  }
  return {
    secrets: {
      entropy: { ...DEFAULT_CONFIG.secrets.entropy, ...user.secrets?.entropy },
      ignorePaths: (user.secrets?.ignorePaths as string[] | undefined) ?? [],
    },
    score: {
      weights: { ...DEFAULT_CONFIG.score.weights, ...user.score?.weights },
      thresholds: { ...DEFAULT_CONFIG.score.thresholds, ...user.score?.thresholds },
    },
  };
}
