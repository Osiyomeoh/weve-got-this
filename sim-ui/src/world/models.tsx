import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// CC0 models by Kenney (kenney.nl), served from public/kit/. See public/kit/LICENSE-kenney.txt.
export const MODEL = {
  character: (name: string) => `/kit/characters/${name}.glb`,
  furniture: (name: string) => `/kit/furniture/${name}.glb`,
  suburban: (name: string) => `/kit/suburban/${name}.glb`,
  car: (name: string) => `/kit/cars/${name}.glb`,
};

type Props = JSX.IntrinsicElements['group'] & {
  url: string;
  tint?: string;
  shadows?: boolean;
  /** Stand it on its own footprint: centred in x and z, resting on y = 0. Kenney models sit on a corner. */
  center?: boolean;
};

/** A static model, cloned so the same file can stand in many places. */
export function Model({ url, tint, shadows = true, center = true, ...rest }: Props) {
  const { scene } = useGLTF(url);
  const copy = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = shadows;
      m.receiveShadow = true;
      if (tint) {
        m.material = (m.material as THREE.MeshStandardMaterial).clone();
        (m.material as THREE.MeshStandardMaterial).color = new THREE.Color(tint);
      }
    });
    if (center) {
      const box = new THREE.Box3().setFromObject(c);
      const mid = box.getCenter(new THREE.Vector3());
      c.position.set(-mid.x, -box.min.y, -mid.z);
    }
    return c;
  }, [scene, tint, shadows, center]);
  return (
    <group {...rest}>
      <primitive object={copy} />
    </group>
  );
}

export type Anim =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'drive'
  | 'emote-yes'
  | 'emote-no'
  | 'interact-right'
  | 'pick-up'
  | 'holding-right'
  | 'wheelchair-sit'
  | 'wheelchair-move-forward';

export interface Gesture {
  kind: 'nod' | 'shake';
  key: number;
}

interface CharacterProps {
  model: string;
  anim: Anim;
  /** Where they stand. They walk there when it changes. */
  position: [number, number, number];
  /** Which way they face, in radians about the vertical. */
  facing?: number;
  scale?: number;
  aid?: 'sunglasses' | 'glasses' | 'wheelchair';
  visible?: boolean;
  /** Walking speed in world units per second. */
  speed?: number;
  /** How far an older body leans forward, in radians: more when they walk. */
  stoop?: number;
  /** A point in the world they are paying attention to. Nothing: their eyes wander. */
  look?: [number, number, number] | null;
  /** Speaking: the head moves with the words and a hand talks too. */
  talking?: boolean;
  /** A phone in the right hand, held up to read. */
  phone?: boolean;
  /** Hands on a keyboard. */
  typing?: boolean;
  /** A nod or a shake of the head, played once each time `key` changes. */
  gesture?: Gesture | null;
}

/**
 * A small motion laid over whatever the clip sets on a bone. Some clips (sit, drive) never
 * touch the head, so the bone keeps last frame's value; undo our own offset before adding
 * this frame's, or it would pile up.
 */
class Layer {
  private base = new THREE.Quaternion();
  private written = new THREE.Quaternion();
  private has = false;
  private offset = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  constructor(readonly bone: THREE.Object3D) {}
  apply(x: number, y: number, z = 0) {
    const q = this.bone.quaternion;
    if (this.has && q.equals(this.written)) q.copy(this.base);
    this.base.copy(q);
    q.multiply(this.offset.setFromEuler(this.euler.set(x, y, z)));
    this.written.copy(q);
    this.has = true;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

/**
 * A person. Each one is its own copy of the rig, so two people never share a pose.
 * Moving them is declarative: change `position` and they walk there, then settle into `anim`.
 * Over the clip they are alive: they breathe, their eyes wander or follow what matters,
 * they talk with their head and hands, nod, and lift a phone to read it.
 */
export function Character({
  model,
  anim,
  position,
  facing = 0,
  scale = 1,
  aid,
  visible = true,
  speed = 1.2,
  stoop = 0,
  look = null,
  talking = false,
  phone = false,
  typing = false,
  gesture = null,
}: CharacterProps) {
  const { scene, animations } = useGLTF(MODEL.character(model));
  // In a wheelchair they sit to rest and roll to move; the chair goes everywhere they do.
  const rest: Anim = aid === 'wheelchair' ? 'wheelchair-sit' : anim;
  const moving: Anim = aid === 'wheelchair' ? 'wheelchair-move-forward' : 'walk';
  const rig = useMemo(() => {
    const c = cloneSkinned(scene) as THREE.Object3D;
    c.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return c;
  }, [scene]);
  const bones = useMemo(() => {
    const find = (name: string) => {
      let b: THREE.Object3D | undefined;
      rig.traverse((o) => {
        if (!b && o.name === name) b = o;
      });
      return b ? new Layer(b) : null;
    };
    return {
      head: find('head'),
      torso: find('torso'),
      armR: find('arm-right'),
      armL: find('arm-left'),
    };
  }, [rig]);
  const root = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, root);
  const target = useRef(new THREE.Vector3(...position));
  const walking = useRef(false);
  // From 0 standing to 1 at full pace: nobody starts or stops walking in an instant.
  const pace = useRef(0);
  const current = useRef<string | null>(null);
  // Each person breathes and glances on their own rhythm, not in step with everyone else.
  const life = useRef({
    seed: Math.random() * 100,
    yaw: 0,
    pitch: 0,
    wander: { yaw: 0, pitch: 0, next: 0 },
    talk: 0,
    phone: 0,
    type: 0,
    gestureAt: -10,
    gestureKind: 'nod' as Gesture['kind'],
  });
  const tmp = useMemo(() => ({ target: new THREE.Vector3(), head: new THREE.Vector3() }), []);

  const play = (name: string) => {
    if (current.current === name) return;
    const next = actions[name];
    if (!next) return;
    const prev = current.current ? actions[current.current] : null;
    // Walk at the pace they are moving, so slow steps are slow, not skating.
    next.timeScale = name === 'walk' ? clamp(speed / 1.2, 0.45, 1.4) : 1;
    next.reset().fadeIn(0.25).play();
    prev?.fadeOut(0.25);
    current.current = name;
  };

  useEffect(() => {
    target.current.set(...position);
    const here = root.current?.position;
    if (here && here.distanceTo(target.current) > 0.05) {
      walking.current = true;
      play(moving);
    } else play(rest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position[0], position[1], position[2], rest, actions]);

  // Start where they belong, not walking in from the origin.
  useEffect(() => {
    root.current?.position.set(...position); /* eslint-disable-next-line */
  }, []);

  const gestureKey = gesture?.key;
  useEffect(() => {
    if (!gesture) return;
    life.current.gestureKind = gesture.kind;
    life.current.gestureAt = -1; // start on the next frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureKey]);

  // Runs after the animation mixer (registered first, in useAnimations), so it layers on top.
  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    if (walking.current) {
      const to = target.current.clone().sub(g.position);
      const d = to.length();
      if (d < 0.03) {
        g.position.copy(target.current);
        walking.current = false;
        pace.current = 0;
        play(rest);
      } else {
        // Speed up over the first steps and slow for the last ones.
        const want = Math.min(1, d / 0.35);
        pace.current += (want - pace.current) * ease(dt, want > pace.current ? 3 : 8);
        const v = speed * Math.max(0.15, pace.current);
        g.position.add(to.normalize().multiplyScalar(Math.min(d, v * dt)));
        const walk = current.current ? actions[current.current] : null;
        if (walk && current.current === 'walk') walk.timeScale = clamp(v / 1.2, 0.35, 1.4);
        // Turn into the new direction, not snap to it.
        const head = Math.atan2(to.x, to.z);
        const turn = Math.atan2(Math.sin(head - g.rotation.y), Math.cos(head - g.rotation.y));
        g.rotation.y += turn * Math.min(1, dt * 7);
      }
    } else {
      // Turn to face where the scene wants them, gently.
      const diff = Math.atan2(Math.sin(facing - g.rotation.y), Math.cos(facing - g.rotation.y));
      g.rotation.y += diff * Math.min(1, dt * 6);
    }
    if (!visible) return;

    const L = life.current;
    const t = clock.elapsedTime + L.seed;
    L.talk += ((talking ? 1 : 0) - L.talk) * ease(dt, 6);
    L.phone += ((phone ? 1 : 0) - L.phone) * ease(dt, 4);
    L.type += ((typing && !talking && !phone ? 1 : 0) - L.type) * ease(dt, 4);
    if (L.gestureAt === -1) L.gestureAt = clock.elapsedTime;

    // Where the eyes go: the phone in their hand, the thing that matters, or nowhere much.
    let wantYaw: number;
    let wantPitch: number;
    if (L.phone > 0.4) {
      wantYaw = -0.15;
      wantPitch = 0.42;
    } else if (look && !walking.current) {
      g.worldToLocal(tmp.target.set(...look));
      bones.head?.bone.getWorldPosition(tmp.head);
      g.worldToLocal(tmp.head);
      const dx = tmp.target.x - tmp.head.x,
        dz = tmp.target.z - tmp.head.z;
      wantYaw = clamp(Math.atan2(dx, dz), -1.25, 1.25);
      wantPitch = clamp(Math.atan2(tmp.head.y - tmp.target.y, Math.hypot(dx, dz)), -0.35, 0.55);
    } else {
      if (clock.elapsedTime > L.wander.next) {
        L.wander = {
          yaw: (Math.random() - 0.5) * 0.9,
          pitch: (Math.random() - 0.3) * 0.25,
          next: clock.elapsedTime + 2.5 + Math.random() * 4.5,
        };
      }
      wantYaw = walking.current ? 0 : L.wander.yaw;
      wantPitch = walking.current ? 0.05 : L.wander.pitch;
    }
    L.yaw += (wantYaw - L.yaw) * ease(dt, 4.5);
    L.pitch += (wantPitch - L.pitch) * ease(dt, 4.5);

    // A nod is two dips; a shake is three turns. Both fade as they finish.
    let nod = 0,
      shake = 0;
    const ge = clock.elapsedTime - L.gestureAt;
    if (ge >= 0 && ge < 1) {
      const k = ge / 1;
      if (L.gestureKind === 'nod') nod = Math.sin(k * Math.PI * 4) * 0.22 * (1 - k);
      else shake = Math.sin(k * Math.PI * 6) * 0.32 * (1 - k);
    }
    const speech = L.talk * (Math.sin(t * 8.3) * 0.045 + Math.sin(t * 13.7) * 0.03);
    const breath = Math.sin(t * 1.7) * 0.018;

    bones.head?.apply(
      L.pitch * 0.75 + nod + speech - stoop * (walking.current ? 0.7 : 0.4),
      L.yaw * 0.75 + shake + L.talk * Math.sin(t * 1.9) * 0.06,
    );
    // An older body leans into the walk; the head comes up to keep the eyes ahead.
    const lean = stoop * (walking.current ? 1 : 0.6);
    bones.torso?.apply(breath + lean + L.pitch * 0.12 + L.type * 0.12, L.yaw * 0.25);
    // Hands: the phone held up to the face, keys under the fingers, or a hand that talks.
    const talkHand = L.talk * (1 - L.phone);
    bones.armR?.apply(
      -0.95 * L.phone -
        L.type * (0.75 + Math.sin(t * 17) * 0.06) +
        talkHand * (Math.sin(t * 2.6) * 0.22 - 0.3),
      0,
      0.4 * L.phone + talkHand * Math.sin(t * 1.7) * 0.1,
    );
    bones.armL?.apply(
      -L.type * (0.75 + Math.sin(t * 15 + 1) * 0.06) +
        talkHand * (Math.sin(t * 2.1 + 1.3) * 0.1 - 0.1),
      0,
      0,
    );
  });

  return (
    <group ref={root} scale={scale} visible={visible}>
      <primitive object={rig} />
      {aid === 'sunglasses' && <Accessory url={MODEL.character('aid-sunglasses')} rig={rig} />}
      {aid === 'glasses' && <Accessory url={MODEL.character('aid-glasses')} rig={rig} />}
      {aid === 'wheelchair' && <Model url={MODEL.character('wheelchair')} center={false} />}
      {bones.armR && <Handset arm={bones.armR.bone} shown={phone} />}
    </group>
  );
}

/** A phone in the right hand, its screen lit while it is up. */
function Handset({ arm, shown }: { arm: THREE.Object3D; shown: boolean }) {
  const g = useMemo(() => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.13, 0.014),
      new THREE.MeshStandardMaterial({ color: '#15181e', roughness: 0.4 }),
    );
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.064, 0.115),
      new THREE.MeshStandardMaterial({
        color: '#cfe9ff',
        emissive: '#8fd0ff',
        emissiveIntensity: 1.4,
        toneMapped: false,
      }),
    );
    screen.position.z = 0.0075;
    group.add(body, screen);
    // Past the fingers (the kit's hands are big blocks), screen turned toward the face once the arm is up.
    group.position.set(0.02, -0.19, 0.08);
    group.rotation.set(Math.PI / 2 + 0.15, 0, 0);
    return group;
  }, []);
  useEffect(() => {
    arm.add(g);
    return () => {
      arm.remove(g);
    };
  }, [arm, g]);
  useFrame((_, dt) => {
    const s = g.scale.x + ((shown ? 1 : 0) - g.scale.x) * ease(dt, 8);
    g.scale.setScalar(s);
    g.visible = s > 0.02;
  });
  return null;
}

/** Glasses ride on the head bone, so they move with the head. */
function Accessory({ url, rig }: { url: string; rig: THREE.Object3D }) {
  const { scene } = useGLTF(url);
  const copy = useMemo(() => scene.clone(true), [scene]);
  useEffect(() => {
    let head: THREE.Object3D | undefined;
    rig.traverse((o) => {
      if (!head && /head/i.test(o.name) && (o as THREE.Bone).isBone) head = o;
    });
    if (!head) return;
    copy.position.set(0, 0.1, 0.12);
    head.add(copy);
    return () => {
      head?.remove(copy);
    };
  }, [rig, copy]);
  return null;
}

export function preloadWorld(models: string[]) {
  for (const m of models) useGLTF.preload(m);
}
