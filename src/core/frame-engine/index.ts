export { AfeError, isAfeError, throwIfAborted } from "./errors";
export {
  parseIsoBmff,
  parseCtts,
  sampleIndexAtTime,
  keyframeAtOrBefore,
  nextKeyframeAfter,
  decodeOrigin,
  earlierKeyframeOrigin,
  isOpenGopAtKey,
  nearestKeyframeIndex,
  mapTimestampIntoTimescale,
  sampleBytes,
  readBoxes,
} from "./mp4-reader";
export type { ParsedBox, ParsedCtts } from "./mp4-reader";
export { parseAvcC, decoderConfigOf } from "./avc-config";
export {
  chunkFingerprintMismatchField,
  chunkFingerprintsEqual,
  compactHash,
  compactHashString,
  comparePacketParity,
  expectedRecoveryChunks,
  fingerprintDecoderConfig,
  fingerprintMovieConfig,
  fingerprintSampleChunk,
  firstChunkAfterRecreateCheck,
  recoveryMatchesColdPrefix,
} from "./parity";
export type {
  ChunkFingerprint,
  DecoderConfigFingerprint,
  FirstChunkAfterRecreate,
  PacketParityResult,
} from "./parity";
export { buildSampleTable } from "./sample-table";
export { DecodedFrameCache } from "./cache";
export { AfeVideoDecoder } from "./decoder";
export type { AwaitReadyHooks } from "./decoder";
export { AfeScheduler, AfeDrawable, getAfeSequentialPrefetch, setAfeSequentialPrefetch } from "./scheduler";
export {
  planSampleIndexes,
  planDecodeSpan,
  isMonotonicRun,
  isPresentationRun,
  shouldSplitPresentationRun,
  maxDecodeIndex,
} from "./plan";
export {
  PtsIndexMap,
  AFE_MAX_REORDER_READY,
  classifyCtts,
  maxReorderSamples,
  addTimescale,
} from "./frame-match";
export {
  AFE_DECODE_STALL_MS,
  AFE_DECODE_QUEUE_HIGH_WATER_CAP,
  AFE_DECODE_QUEUE_RECOVERY_FILL,
  AFE_DECODE_WINDOW_LOOKAHEAD,
  AFE_POST_RECREATE_OUTPUT_BUDGET_MS,
  AFE_FLUSH_WATCHDOG_MS,
  AFE_SETTLE_DRAIN_MS,
  AFE_STALL_NUDGE_MS,
  AFE_STALL_NUDGE_WAIT_MS,
  AFE_WAIT_EXACT_PTS_MS,
  classifySampleRole,
  decodeQueueHighWater,
  decodeQueueLowWater,
  decodeWindowBNeed,
  decodeWindowLookahead,
  emptyStallSnapshot,
  formatStallMessage,
  hasFurtherUsefulInput,
  hostSafeSourceName,
  isExportTransactionComplete,
  isTransactionComplete,
  requestedEncodedInvariantHolds,
  isTrueTransactionTail,
  lastRequiredDecodeSample,
  legacyPumpSubmitEnd,
  mayFinalFlush,
  maySubmitEncoded,
  mayResumeDecode,
  mayEarlierKeyframeRecover,
  noMoreSubmissionRequired,
  frozenHighWaterDeadlock,
  usefulInputExhausted,
  usefulProgressImpossible,
  nowMs,
  originFromStall,
  progressivePumpSliceEnd,
  pumpMoreSubmitEnd,
  pumpSubmitEnd,
  requestOwnershipHolds,
  requestedPtsIsPending,
  requestedVideoFateLegal,
  REQUESTED_VIDEO_FATES,
  streamLookaheadSamples,
} from "./stall";
export type {
  AfeDumpPictureKind,
  AfeStallPhase,
  AfeStallSnapshot,
  PumpMoreArgs,
  PumpSubmitArgs,
  RequestOwnershipState,
  SampleFate,
  SampleRole,
  SubmitPhaseTrace,
} from "./stall";
export {
  samplePtsToChunkTimestampUs,
  sampleDurationToChunkDurationUs,
  chunkTimestampUsToTicks,
  mapSampleToWebCodecs,
  ticksToUs,
} from "./timestamps";
export type { WebCodecsTimestampMapping } from "./timestamps";
export type { CttsKind } from "./frame-match";
export type { AfeDecodeSpan } from "./plan";
export {
  AilexsiFrameSourceBackend,
  HtmlVideoFrameSourceBackend,
  createFrameSourceBackend,
  openFrameSource,
} from "./backend";
export {
  AFE_PERF_COUNTS,
  AFE_PERF_PHASES,
  afePerfAdd,
  afePerfCount,
  afePerfMax,
  afePerfEnabled,
  afePerfProbeInstalled,
  afePerfTime,
  afePerfTimeAsync,
  beginAfePerf,
  endAfePerf,
  installWebCodecsProbe,
  peekAfePerf,
  summarizePhases,
  uninstallWebCodecsProbe,
} from "./perf";
export type { AfePerfBackend, AfePerfCount, AfePerfPhase, AfePerfSnapshot } from "./perf";
export type {
  AfeAvcConfig,
  AfeCttsKind,
  AfeErrorCode,
  AfeMemoryStats,
  AfeMismatch,
  AfeMovie,
  AfeSample,
  DrawableFrame,
  FrameSourceBackend,
  FrameSourceBackendId,
  OpenedFrameSource,
} from "./types";
