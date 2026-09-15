/**
 * Vendored AILEXSI Visualz 0.1.0-blueprint (https://github.com/AILEXSI/ailexsi-visualz @ b67410c).
 * AGPL-free, from-scratch Canvas 2D. Not a live npm dependency. Not copied from V4.
 */

export type {
  AudioAnalyserConfig,
  AudioFeatures,
  Scene,
  SceneContext,
  SceneParams,
  VisualEngineOptions,
  VisualState,
} from "./types";
export { createVisualEngine, ensureBuiltinsRegistered, getRegisteredScene, registerScene } from "./engine";
export type { VisualEngine } from "./engine";
export { builtinScenes } from "./scenes";
export {
  applySilenceGate,
  createFeatureExtractor,
  isSilentEnergy,
  SILENCE_BASS,
  SILENCE_RMS,
} from "./feature-extractor";
export type { FeatureExtractor } from "./feature-extractor";
