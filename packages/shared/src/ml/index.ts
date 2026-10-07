import spec from "./features.json" with { type: "json" };

// The bug-risk feature spec. features.json is the single source of truth, read by both
// this TypeScript code (CLI extraction) and the Python training pipeline (services/ml).

export type FeatureName =
  | "la"
  | "ld"
  | "nf"
  | "entropy"
  | "nuc"
  | "ndev"
  | "age_days"
  | "prior_fixes"
  | "exp"
  | "is_fix"
  | "loc";

export type FeatureVector = Record<FeatureName, number>;

export const FEATURE_SPEC_VERSION: number = spec.version;
export const FEATURE_ORDER = spec.featureOrder as FeatureName[];
export const FIX_REGEX = new RegExp(spec.fixRegex, "i");
export const ANALYSED_EXTENSIONS: readonly string[] = spec.extensions;
export const MAX_FILES_PER_COMMIT: number = spec.maxFilesPerCommit;
export const MAX_ROWS_PER_PUSH: number = spec.maxRowsPerPush;

/** One (commit, file) change, as extracted on the developer's machine. */
export interface FeatureRow {
  commit: string;
  file: string;
  features: FeatureVector;
}

export type RiskLevel = "low" | "medium" | "high";

/** Body of POST /predict. Ids are opaque; file paths and code never leave the machine. */
export interface PredictRequest {
  rows: Array<{ id: string; features: FeatureVector }>;
}

export interface PredictResponse {
  model_version: string;
  threshold: number;
  rows: Array<{ id: string; probability: number; level: RiskLevel }>;
}

export function isAnalysedFile(path: string): boolean {
  const lower = path.toLowerCase();
  return ANALYSED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
