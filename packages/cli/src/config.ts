import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SCORE_CONFIG, type ScoreConfig } from "@preflux/shared";
import { DEFAULT_ENTROPY_CONFIG, type EntropyConfig } from "@preflux/shared/secrets";

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
    entropy: DEFAULT_ENTROPY_CONFIG,
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
