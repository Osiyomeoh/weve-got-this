import * as THREE from 'three';

// Where everything stands. One street in Lagos: Daddy's bungalow on one side, Tolu's flat
// further along, the pharmacy across the road, and the MCP server drawn above it all.

export type V3 = [number, number, number];

export const DADDY: V3 = [-6, 0, -3.4];
export const TOLU: V3 = [6.5, 0, -3.4];
export const PHARMACY: V3 = [0, 0, 6.2];
export const HUB: V3 = [0, 5.2, -2.5];
export const ROAD_Z = 2.3;

const at = (base: V3, x: number, y: number, z: number): V3 => [
  base[0] + x,
  base[1] + y,
  base[2] + z,
];

/** Devices, in world space, so a message can be drawn leaving one and reaching another. */
export const DEVICE = {
  daddyEcho: at(DADDY, 0.95, 0.38, 0.45),
  daddyTv: at(DADDY, 0, 0.62, -1.68),
  doorbell: at(DADDY, 1.95, 0.62, 1.86),
  toluEcho: at(TOLU, 0.5, 0.38, -0.85),
};

/** Where each person stands (or sits) in each moment of the story. */
export const SPOT = {
  daddyChair: at(DADDY, 0.2, 0, 0.45),
  daddyDoor: at(DADDY, 1.6, 0, 1.25),
  toluDesk: at(TOLU, 0, 0, -0.45),
  toluWindow: at(TOLU, -1.1, 0, -0.9),
  musaCarMidday: [3.2, 0, ROAD_Z + 0.95] as V3,
  musaPharmacy: [0.9, 0, PHARMACY[2] - 1.1] as V3,
  musaDoorPath: at(DADDY, 1.6, 0, 2.6),
  musaAtDoor: at(DADDY, 1.6, 0, 2.05),
};

export const CAR = {
  midday: [3.2, 0, ROAD_Z] as V3,
  pharmacy: [0.2, 0, ROAD_Z + 0.55] as V3,
  daddy: [DADDY[0] + 1.6, 0, ROAD_Z] as V3,
};

export interface Shot {
  pos: V3;
  look: V3;
}

export const SHOTS: Record<string, Shot> = {
  overview: { pos: [0.5, 9.5, 12], look: [0, 0.8, -1.8] },
  daddy: { pos: at(DADDY, 1.85, 1.55, -1.4), look: at(DADDY, 0.1, 0.4, 0.6) },
  // In front of the chair, so whoever is sitting in it never stands between us and the screen.
  daddyTv: { pos: at(DADDY, 0.3, 0.85, -0.45), look: at(DADDY, 0, 0.6, -1.7) },
  tolu: { pos: at(TOLU, 1.25, 1.35, -1.35), look: at(TOLU, -0.1, 0.4, -0.15) },
  musa: { pos: [5.6, 1.5, ROAD_Z + 3.6], look: [3.2, 0.45, ROAD_Z + 0.7] },
  pharmacy: { pos: [2.4, 1.8, ROAD_Z - 1.2], look: [0.3, 0.6, PHARMACY[2] - 1] },
  door: { pos: at(DADDY, 3.6, 1.5, 4.8), look: at(DADDY, 1.6, 0.5, 1.9) },
  both: { pos: [0, 6.2, 9.5], look: [0, 1.6, -2.5] },
  hub: { pos: [0, 5.6, 5.5], look: [0, 4.6, -2.5] },
};

export const v3 = (p: V3) => new THREE.Vector3(...p);
