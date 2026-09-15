/**
 * AILEXSI Visualz — Built-in scenes (ported from b67410c) plus V5 Canvas-2D additions.
 * Cycle order matches VISUALIZER_SCENE_IDS.
 */

import type { Scene } from "../types";
import { spectrumBarsScene } from "./spectrum-bars";
import { pulseOrbScene } from "./pulse-orb";
import { auroraVeilScene } from "./aurora-veil";
import { starBloomScene } from "./star-bloom";
import { liquidGoldScene } from "./liquid-gold";
import { kaleidoHexScene } from "./kaleido-hex";
import { sunCoreScene } from "./sun-core";
import { emberRainScene } from "./ember-rain";
import { particleFieldScene } from "./particle-field";
import { resonanceWaveScene } from "./resonance-wave";
import { tunnelSpiralScene } from "./tunnel-spiral";
import { litaBloomScene } from "./lita-bloom";
import { voidLatticeScene } from "./void-lattice";
import { nebulaHelixScene } from "./nebula-helix";
import { accretionDiskScene } from "./accretion-disk";
import { crystalStormScene } from "./crystal-storm";

export const builtinScenes: Scene[] = [
  spectrumBarsScene,
  pulseOrbScene,
  auroraVeilScene,
  starBloomScene,
  liquidGoldScene,
  kaleidoHexScene,
  sunCoreScene,
  emberRainScene,
  particleFieldScene,
  resonanceWaveScene,
  tunnelSpiralScene,
  litaBloomScene,
  voidLatticeScene,
  nebulaHelixScene,
  accretionDiskScene,
  crystalStormScene,
];

export {
  spectrumBarsScene,
  pulseOrbScene,
  auroraVeilScene,
  starBloomScene,
  liquidGoldScene,
  kaleidoHexScene,
  sunCoreScene,
  emberRainScene,
  particleFieldScene,
  resonanceWaveScene,
  tunnelSpiralScene,
  litaBloomScene,
  voidLatticeScene,
  nebulaHelixScene,
  accretionDiskScene,
  crystalStormScene,
};
