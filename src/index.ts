/**
 * flowmesh — public API exports.
 */

export type {
  NormalizedMessage,
  Address,
  Attachment,
  MessageFlags,
  MessageRefs,
  ClassifierResult,
  ClassifiedMessage,
  TriageResult,
  TriagePlan,
  PlannedAction,
} from "./core/types.js";

export type {
  ProviderAdapter,
  ListParams,
  MutateAction,
  MutateResult,
} from "./core/provider.js";

export {
  registerProvider,
  getProvider,
  listProviders,
} from "./core/provider.js";

export type { Classifier, ClassifierConfig } from "./core/classify.js";
export {
  PassthroughClassifier,
  ShellClassifier,
  createClassifier,
} from "./core/classify.js";

export {
  RulesClassifier,
  createRulesClassifier,
  DEFAULT_RULES,
} from "./core/rules-classifier.js";
export type {
  ClassificationRule,
  RuleMatch,
  RuleResultSpec,
} from "./core/rules-classifier.js";

export { emit, emitJson, emitJsonl, log, warn } from "./core/emit.js";
export type { OutputFormat } from "./core/emit.js";

export { loadConfig, resolveSource, findWorkflowForSource } from "./config/load.js";
export type { FlowmeshConfig, AccountConfig, WorkflowConfig } from "./config/load.js";

export { registerAllProviders } from "./providers/index.js";

export { GogError } from "./providers/gog.js";
export type { GogErrorCode } from "./providers/gog.js";
export { ImapError, extractImapConfig, normalizeImapMessage } from "./providers/imap.js";
export type { ImapErrorCode, ImapConnectionConfig } from "./providers/imap.js";

// Pilot / comparison
export type {
  MessageDiff,
  ComparisonSummary,
  ComparisonReport,
  PilotResult,
} from "./core/types.js";

export { compareTriageResults } from "./pipelines/compare.js";
export { captureLegacy, parseLegacyOutput } from "./pipelines/legacy-capture.js";
export type { LegacyCaptureOptions } from "./pipelines/legacy-capture.js";
export { runTriageCapture } from "./pipelines/triage-capture.js";
export type { TriageCaptureOptions } from "./pipelines/triage-capture.js";
export { runPilot } from "./pipelines/pilot.js";
export type { PilotEngine, PilotOptions } from "./pipelines/pilot.js";
