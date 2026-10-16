import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, RoundedBox } from '@react-three/drei';
import type * as THREE from 'three';
import { CAST, type PersonKey } from './cast';
import { Character } from './models';
import { Doorbell, Echo } from './devices';
import { chime, music } from './music';

// The way in. A short start-up, as a new Fire TV or Echo walks you through, naming the Amazon
// devices this story runs on, each floating in 3D; then the family, standing on their cards.
// Our own words about the devices, not Amazon's adverts. The first click starts the music.

const SEEN_KEY = 'carecircle-intro-seen';

const STEPS = [
  {
    name: 'Alexa+',
    line: 'Say it once, in your own words. Alexa+ hands it to We’ve Got This, and the whole family is on one record.',
    device: 'echo',
  },
  {
    name: 'Fire TV',
    line: 'The screen already in the room. A dose question pops up over the programme, and one press of the remote answers it.',
    device: 'tv',
  },
  {
    name: 'Ring Video Doorbell',
    line: 'Sees someone at the door, and says only that. It never claims to know who.',
    device: 'ring',
  },
] as const;

export function introSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** The start-up: a welcome, then one card per device, then the family. */
export function Intro({ muted, onDone }: { muted: boolean; onDone: () => void }) {
  const [step, setStep] = useState(-1);
  const go = (n: number) => {
    if (!muted) {
      music(true);
      chime(n);
    }
    if (n >= STEPS.length) {
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* fine: it shows again */
      }
      onDone();
      return;
    }
    setStep(n);
  };
  const s = STEPS[step];
  return (
    <div className="world-intro">
      <div className="world-intro-stage">
        <Canvas camera={{ position: [0, 0.15, 1.1], fov: 35 }} dpr={[1, 2]}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 3, 2]} intensity={1.4} />
          <pointLight position={[-1, 0.5, 1]} intensity={1.5} color="#00caff" />
          <Float speed={2} rotationIntensity={0.6} floatIntensity={0.8}>
            <Spin>
              {(step === -1 || s?.device === 'echo') && (
                <Echo
                  glow={step === -1 ? 'thinking' : 'speaking'}
                  scale={2.6}
                  position={[0, -0.12, 0]}
                />
              )}
              {s?.device === 'tv' && <Telly />}
              {s?.device === 'ring' && <Doorbell active scale={3.2} />}
            </Spin>
          </Float>
        </Canvas>
      </div>
      <div className="world-intro-card" key={step}>
        {s ? (
          <>
            <div className="kicker">
              Works with We’ve Got This · {step + 1} of {STEPS.length}
            </div>
            <h1>{s.name}</h1>
            <p>{s.line}</p>
          </>
        ) : (
          <>
            <div className="kicker">We’ve Got This for Alexa+</div>
            <h1>One family's day, played for real</h1>
            <p>
              Three Amazon devices, one care record, and a family who never has to open an app. Turn
              your sound on.
            </p>
          </>
        )}
        <div className="world-intro-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <div className="row">
          <button className="world-btn" onClick={() => go(step + 1)}>
            {step === -1 ? 'Begin' : step === STEPS.length - 1 ? 'Meet the family' : 'Next'}
          </button>
          {step < STEPS.length - 1 && (
            <button className="world-btn ghost" onClick={() => go(STEPS.length)}>
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Turns slowly, so the device is seen from every side. */
function Spin({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.y += dt * 0.5;
  });
  return <group ref={g}>{children}</group>;
}

/** A Fire TV set with its picture glowing, drawn here rather than loading the live page. */
function Telly() {
  return (
    <group>
      <RoundedBox args={[0.62, 0.36, 0.025]} radius={0.01}>
        <meshStandardMaterial color="#111" roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0, 0.0135]}>
        <planeGeometry args={[0.59, 0.33]} />
        <meshStandardMaterial
          color="#0d3b4f"
          emissive="#1b8fb8"
          emissiveIntensity={0.9}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0.12, -0.08, 0.015]}>
        <planeGeometry args={[0.25, 0.09]} />
        <meshStandardMaterial color="#000" transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, -0.21, 0]}>
        <boxGeometry args={[0.2, 0.012, 0.08]} />
        <meshStandardMaterial color="#222" />
      </mesh>
    </group>
  );
}

/** A person on their cast card: floating, turning to face you, waving yes when you point at them. */
export function CardFigure({ who, hover }: { who: PersonKey; hover: boolean }) {
  const p = CAST[who]!;
  return (
    <div className="world-cast-figure" aria-hidden>
      <Canvas
        camera={{ position: [0, 1.1, 2.3], fov: 34 }}
        dpr={[1, 2]}
        onCreated={({ camera }) => camera.lookAt(0, 0.65, 0)}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} />
        <pointLight position={[0, 0.5, 1.5]} intensity={2} color={p.color} />
        <Suspense fallback={null}>
          <Float
            speed={hover ? 4 : 1.6}
            rotationIntensity={0.15}
            floatIntensity={hover ? 1.2 : 0.6}
          >
            <Character
              model={p.model}
              anim={hover ? 'emote-yes' : p.aid === 'wheelchair' ? 'wheelchair-sit' : 'idle'}
              position={[0, 0, 0]}
              scale={1.3}
              {...(p.aid ? { aid: p.aid } : {})}
            />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
              <circleGeometry args={[0.45, 48]} />
              <meshStandardMaterial
                color={p.color}
                emissive={p.color}
                emissiveIntensity={hover ? 0.9 : 0.35}
                transparent
                opacity={0.55}
              />
            </mesh>
          </Float>
        </Suspense>
      </Canvas>
    </div>
  );
}

export function useHover() {
  const [hover, setHover] = useState(false);
  useEffect(() => () => setHover(false), []);
  return {
    hover,
    bind: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onFocus: () => setHover(true),
      onBlur: () => setHover(false),
    },
  };
}
