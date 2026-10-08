import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

export type Glow = 'idle' | 'listening' | 'thinking' | 'speaking';

const RING_COLOR: Record<Glow, string> = {
  idle: '#0b1a24', listening: '#2f7cff', thinking: '#3fd0ff', speaking: '#00e0c6',
};

/**
 * A smart speaker with a light ring. The ring means one thing at a time, as on the real
 * device: blue while it listens, a sweep while it thinks, teal while it speaks.
 */
export function Echo({ glow, ...rest }: JSX.IntrinsicElements['group'] & { glow: Glow }) {
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const on = glow !== 'idle';
    const pulse = glow === 'thinking' ? 0.6 + 0.4 * Math.sin(clock.elapsedTime * 8)
      : glow === 'speaking' ? 0.75 + 0.25 * Math.sin(clock.elapsedTime * 14) : 1;
    if (ring.current) {
      ring.current.emissive.set(RING_COLOR[glow]);
      ring.current.emissiveIntensity = on ? 3 * pulse : 0.2;
    }
    if (light.current) light.current.intensity = on ? 1.6 * pulse : 0;
  });
  return (
    <group {...rest}>
      {/* the body: a fabric sphere sitting on a flat base */}
      <mesh castShadow position={[0, 0.07, 0]}>
        <sphereGeometry args={[0.075, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.8]} />
        <meshStandardMaterial color="#5d6670" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.066, 0.009, 12, 48]} />
        <meshStandardMaterial ref={ring} color="#0b1a24" emissive={RING_COLOR[glow]} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, 0.05, 0.1]} distance={1.2} color={RING_COLOR[glow === 'idle' ? 'speaking' : glow]} />
    </group>
  );
}

/**
 * The family's TV, showing the real Fire TV page from this visitor's own copy of the demo.
 * It is the same /tv a Fire TV loads, so what changes here changed in the record.
 */
export function FireTV({ src, width = 0.62, live = true, frameId, ...rest }: JSX.IntrinsicElements['group'] & { src: string; width?: number; live?: boolean; frameId?: string }) {
  const px = 1280;
  const height = width * 9 / 16;
  return (
    <group {...rest}>
      <mesh castShadow position={[0, 0, -0.02]}>
        <boxGeometry args={[width + 0.03, height + 0.03, 0.03]} />
        <meshStandardMaterial color="#0d0f12" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, -0.004]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#05070a" />
      </mesh>
      {live && (
        <Html transform occlude="blending" distanceFactor={(width / px) * 400} position={[0, 0, 0]} zIndexRange={[5, 0]}
          style={{ width: px, height: px * 9 / 16, background: '#05070a' }} pointerEvents="none">
          <iframe id={frameId} title="Fire TV" src={src} allow="autoplay" style={{ width: px, height: px * 9 / 16, border: 0 }} />
        </Html>
      )}
    </group>
  );
}

/** A video doorbell by the front door. It flashes when it reports activity. */
export function Doorbell({ active, ...rest }: JSX.IntrinsicElements['group'] & { active: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.emissiveIntensity = active ? 2 + Math.sin(clock.elapsedTime * 10) * 1.5 : 0.4;
  });
  return (
    <group {...rest}>
      <mesh castShadow>
        <boxGeometry args={[0.05, 0.12, 0.025]} />
        <meshStandardMaterial color="#1d2126" roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.028, 0.0135]}>
        <circleGeometry args={[0.014, 24]} />
        <meshStandardMaterial ref={mat} color="#0a2a3a" emissive="#33b6ff" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.03, 0.0135]}>
        <circleGeometry args={[0.01, 24]} />
        <meshStandardMaterial color="#000" roughness={0.1} />
      </mesh>
    </group>
  );
}

/**
 * The CareCircle MCP server, drawn as one place above the town: every device's words
 * travel up to it and every answer comes back down from it.
 */
export function Hub({ busy, ...rest }: JSX.IntrinsicElements['group'] & { busy: boolean }) {
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    if (core.current) core.current.rotation.y += dt * (busy ? 2.2 : 0.4);
    if (halo.current) {
      const s = 1 + (busy ? 0.18 : 0.05) * Math.sin(clock.elapsedTime * (busy ? 7 : 2));
      halo.current.scale.setScalar(s);
    }
  });
  return (
    <group {...rest}>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.45, 1]} />
        <meshStandardMaterial color="#0e2a33" emissive="#00e0c6" emissiveIntensity={busy ? 2.2 : 0.8} flatShading toneMapped={false} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[0.75, 32, 16]} />
        <meshBasicMaterial color="#00e0c6" transparent opacity={busy ? 0.14 : 0.06} depthWrite={false} />
      </mesh>
      <Html position={[0, -0.95, 0]} center pointerEvents="none" zIndexRange={[5, 0]}>
        <div className="world-label hub">CareCircle · MCP server</div>
      </Html>
    </group>
  );
}

export interface PulseSpec { id: number; from: THREE.Vector3; to: THREE.Vector3; color: string; label?: string }

/** One message in flight: a bright bead along an arc from one device to another. */
export function Pulse({ spec, onDone, seconds = 0.9 }: { spec: PulseSpec; onDone: (id: number) => void; seconds?: number }) {
  const bead = useRef<THREE.Mesh>(null);
  const t = useRef(0);
  const curve = useMemo(() => {
    const mid = spec.from.clone().lerp(spec.to, 0.5);
    mid.y = Math.max(spec.from.y, spec.to.y) + 1.5;
    return new THREE.QuadraticBezierCurve3(spec.from, mid, spec.to);
  }, [spec]);
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 48, 0.012, 6, false), [curve]);
  const trail = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, dt) => {
    t.current += dt / seconds;
    if (bead.current) bead.current.position.copy(curve.getPoint(Math.min(1, t.current)));
    if (trail.current) trail.current.opacity = Math.max(0, 0.5 * (1.4 - t.current));
    if (t.current >= 1.4) onDone(spec.id);
  });
  return (
    <group>
      <mesh geometry={tube}>
        <meshBasicMaterial ref={trail} color={spec.color} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={bead}>
        <sphereGeometry args={[0.07, 16, 12]} />
        <meshBasicMaterial color={spec.color} toneMapped={false} />
      </mesh>
    </group>
  );
}
