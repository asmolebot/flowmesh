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

export { emit, emitJson, emitJsonl, log, warn } from "./core/emit.js";
export type { OutputFormat } from "./core/emit.js";

export { loadConfig } from "./config/load.js";
export type { FlowmeshConfig, AccountConfig, WorkflowConfig } from "./config/load.js";

export { registerAllProviders } from "./providers/index.js";
