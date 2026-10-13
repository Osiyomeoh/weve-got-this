import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CameraControls, Html, Sky, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { CAST, type PersonKey } from './cast';
import { Character, Model, MODEL, type Anim } from './models';
import { Doorbell, Echo, FireTV, Hub, Pulse, type PulseSpec } from './devices';
import { CAR, DADDY, DEVICE, HUB, PHARMACY, ROAD_Z, SHOTS, SPOT, TOLU, type V3 } from './layout';
import { homeHour, type ShotName, type Stage } from './story';
import type { LookAt, Presence, WorldView } from './director';
import { wait } from './voice';
import { family } from './families';

// The street. Two homes drawn as cutaways so you can see inside, the road between them
// and the pharmacy, a few neighbours, and the server above it all. Furniture and people
// are Kenney's CC0 kits; walls, floors and devices are drawn here.

/** Kenney's people are a little small beside Kenney's furniture. */
const PERSON_SCALE = 1.3;
const FACE = { away: Math.PI, toward: 0, left: -Math.PI / 2, right: Math.PI / 2 };

export function Scene({
  view,
  onPulseDone,
}: {
  view: WorldView;
  onPulseDone: (id: number) => void;
}) {
  const hour = homeHour(view.clock);
  return (
    <>
      <Daylight hour={hour} />
      <Director shot={view.shot} />
      <Ground />
      <Suspense fallback={null}>
        <Neighbourhood />
        <DaddysHouse view={view} night={isNight(hour)} />
        <ToluFlat view={view} night={isNight(hour)} />
        <Pharmacy night={isNight(hour)} />
        <MusaRig
          stage={view.musa}
          phone={view.phones.musa}
          listening={view.phoneListening === 'musa'}
          life={alive('musa', view.people)}
        />
      </Suspense>
      <Hub position={HUB} busy={view.hubBusy} />
      {view.pulses.map((p: PulseSpec) => (
        <Pulse key={p.id} spec={p} onDone={onPulseDone} />
      ))}
    </>
  );
}

const isNight = (h: number) => h >= 18.7 || h < 6.2;

/** The sun crosses the sky with the story clock; at night the lamps come on. */
function Daylight({ hour }: { hour: number }) {
  const day = (hour - 6.3) / 12.4; // 0 at sunrise, 1 at sunset
  const up = Math.sin(Math.PI * Math.min(1, Math.max(0, day)));
  const sun = useMemo(
    () => new THREE.Vector3(Math.cos(Math.PI * day) * 30, Math.max(-6, up * 28 - 2), -12),
    [day, up],
  );
  const night = isNight(hour);
  const dusk = Math.max(0, 1 - Math.abs(day - 1) * 6) + Math.max(0, 1 - Math.abs(day) * 6);
  return (
    <>
      {!night && (
        <Sky sunPosition={sun} turbidity={6} rayleigh={1.2 + dusk * 2} mieCoefficient={0.006} />
      )}
      {night && <color attach="background" args={['#070b18']} />}
      {night && <Stars radius={80} depth={30} count={2500} factor={3} fade speed={0.3} />}
      <fog attach="fog" args={[night ? '#070b18' : '#cfe3f0', 26, 60]} />
      <hemisphereLight
        args={[
          night ? '#3a4a7a' : '#e6f3ff',
          night ? '#141a28' : '#6b6a52',
          night ? 0.55 : 0.9 + up * 0.5,
        ]}
      />
      <ambientLight intensity={night ? 0.12 : 0.25} />
      <directionalLight
        castShadow
        position={night ? [-8, 14, 6] : (sun.toArray() as V3)}
        color={night ? '#8fa6ff' : dusk > 0.3 ? '#ffb27a' : '#fff4e0'}
        intensity={night ? 0.25 : 0.6 + up * 1.6}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-bias={-0.0005}
      />
    </>
  );
}

/** The camera moves between the story's shots; between moves, the visitor can look around. */
function Director({ shot }: { shot: ShotName }) {
  const controls = useRef<CameraControls>(null);
  const first = useRef(true);
  useEffect(() => {
    const s = SHOTS[shot] ?? SHOTS.overview!;
    void controls.current?.setLookAt(...s.pos, ...s.look, !first.current);
    first.current = false;
  }, [shot]);
  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={1}
      maxDistance={30}
      maxPolarAngle={Math.PI * 0.48}
      smoothTime={0.9}
    />
  );
}

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#6f8f4e" roughness={1} />
      </mesh>
      {/* the road, its kerbs and the line down the middle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0.005, ROAD_Z]}>
        <planeGeometry args={[60, 1.7]} />
        <meshStandardMaterial color="#3a3d42" roughness={0.95} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          position={[0, 0.008, ROAD_Z + side * 1.1]}
        >
          <planeGeometry args={[60, 0.5]} />
          <meshStandardMaterial color="#b9b2a5" roughness={1} />
        </mesh>
      ))}
      {Array.from({ length: 30 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-29 + i * 2, 0.01, ROAD_Z]}>
          <planeGeometry args={[0.8, 0.05]} />
          <meshBasicMaterial color="#e8d27a" />
        </mesh>
      ))}
    </group>
  );
}

function Neighbourhood() {
  const houses: { type: string; at: V3; turn?: number }[] = [
    { type: 'a', at: [-13, 0, -4] },
    { type: 'e', at: [0.3, 0, -6.2] },
    { type: 'g', at: [13.5, 0, -4] },
    // across the road, kept to the ends of the street so the camera can see over it
    { type: 'b', at: [-12, 0, 7.2], turn: Math.PI },
    { type: 'h', at: [12.5, 0, 7.2], turn: Math.PI },
  ];
  const trees: V3[] = [
    [-9.4, 0, -1.2],
    [-2.6, 0, -1],
    [2.8, 0, -1.2],
    [10, 0, -1],
    [-14, 0, 4.2],
    [-7.5, 0, 4.6],
    [3.4, 0, 5.2],
    [8, 0, 4.4],
    [14, 0, 4.3],
    [-3.5, 0, -7.5],
    [4.5, 0, -8],
  ];
  return (
    <group>
      {houses.map((h) => (
        <Model
          key={h.type}
          url={MODEL.suburban(`building-type-${h.type}`)}
          position={h.at}
          rotation={[0, h.turn ?? 0, 0]}
          scale={3.2}
        />
      ))}
      {trees.map((t, i) => (
        <Model
          key={i}
          url={MODEL.suburban(i % 3 ? 'tree-large' : 'tree-small')}
          position={t}
          scale={3 + (i % 2) * 0.6}
        />
      ))}
    </group>
  );
}

/** Walls for a room drawn as a dollhouse: the two walls nearest the camera stay low. */
function Room({
  at,
  w,
  d,
  floor,
  wall,
  low,
}: {
  at: V3;
  w: number;
  d: number;
  floor: string;
  wall: string;
  low: ('front' | 'back' | 'left' | 'right')[];
}) {
  const H = 1.15;
  const T = 0.08;
  const h = (side: 'front' | 'back' | 'left' | 'right') => (low.includes(side) ? 0.18 : H);
  const walls: { side: 'front' | 'back' | 'left' | 'right'; pos: V3; size: V3 }[] = [
    { side: 'back', pos: [0, h('back') / 2, -d / 2], size: [w + T, h('back'), T] },
    { side: 'front', pos: [0, h('front') / 2, d / 2], size: [w + T, h('front'), T] },
    { side: 'left', pos: [-w / 2, h('left') / 2, 0], size: [T, h('left'), d] },
    { side: 'right', pos: [w / 2, h('right') / 2, 0], size: [T, h('right'), d] },
  ];
  return (
    <group position={at}>
      <mesh receiveShadow position={[0, 0.02, 0]}>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial color={floor} roughness={0.8} />
      </mesh>
      {walls.map((x) => (
        <mesh key={x.side} castShadow receiveShadow position={x.pos}>
          <boxGeometry args={x.size} />
          <meshStandardMaterial color={wall} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** A window in a back wall, glowing warm once the lamps are on. */
function Window({ at, night, w = 0.9 }: { at: V3; night: boolean; w?: number }) {
  return (
    <mesh position={at}>
      <planeGeometry args={[w, 0.5]} />
      <meshStandardMaterial
        color={night ? '#1a2440' : '#bfe3ff'}
        emissive={night ? '#0d1730' : '#7fb8e0'}
        emissiveIntensity={0.6}
      />
    </mesh>
  );
}

function Lamp({ at, night }: { at: V3; night: boolean }) {
  return (
    <pointLight
      position={at}
      color="#ffc98a"
      intensity={night ? 2.2 : 0}
      distance={4.5}
      decay={1.6}
      castShadow={false}
    />
  );
}

const local = (base: V3, x: number, y: number, z: number): V3 => [
  base[0] + x,
  base[1] + y,
  base[2] + z,
];

const LAPTOP = local(TOLU, -0.1, 0.45, -0.95);
/** Where Daddy is: in his chair, or up at the front door. In a wheelchair, his own chair is the seat. */
const daddySpot = (at: Presence['at']): V3 =>
  at === 'door'
    ? SPOT.daddyDoor
    : CAST.daddy!.aid === 'wheelchair'
      ? SPOT.daddyChair
      : local(SPOT.daddyChair, 0, 0.12, 0.08);

/** The point in the world a person's attention goes to. */
function lookPoint(who: PersonKey, look: LookAt, people: WorldView['people']): V3 | null {
  switch (look) {
    case 'echo':
      return who === 'tolu' ? DEVICE.toluEcho : DEVICE.daddyEcho;
    case 'tv':
      return DEVICE.daddyTv;
    case 'laptop':
      return LAPTOP;
    case 'door':
      return DEVICE.doorbell;
    case 'daddy': {
      const p = daddySpot(people.daddy!.at);
      return [p[0], p[1] + (people.daddy!.at === 'door' ? 0.8 : 0.62), p[2]];
    }
    case 'musa':
      return [SPOT.musaAtDoor[0], 0.8, SPOT.musaAtDoor[2]];
    default:
      return null;
  }
}

/** Everything a Character needs to be alive, from how the person is right now. */
function alive(who: PersonKey, people: WorldView['people']) {
  const p = people[who]!;
  return {
    look: lookPoint(who, p.look, people),
    talking: p.talking,
    phone: p.phone,
    gesture: p.gesture,
  };
}

function PhoneBubble({
  who,
  message,
  listening,
}: {
  who: PersonKey;
  message?: { from: string; text: string; key: string };
  listening: boolean;
}) {
  const [shown, setShown] = useState(message);
  useEffect(() => {
    setShown(message);
    if (!message) return;
    const id = setTimeout(() => setShown(undefined), 11_000);
    return () => clearTimeout(id);
  }, [message?.key]);
  if (!shown && !listening) return null;
  return (
    <Html position={[0, 1.25, 0]} center pointerEvents="none" zIndexRange={[20, 0]}>
      <div className="phone-bubble" style={{ borderColor: CAST[who]!.color }}>
        <div className="phone-bubble-top">{CAST[who]!.name}'s phone</div>
        {listening && !shown && (
          <div className="phone-bubble-text listening">Speaking to Alexa…</div>
        )}
        {shown && (
          <>
            <div className="phone-bubble-from">{shown.from}</div>
            <div className="phone-bubble-text">{shown.text}</div>
          </>
        )}
      </div>
    </Html>
  );
}

function DaddysHouse({ view, night }: { view: WorldView; night: boolean }) {
  const daddy = CAST.daddy!;
  return (
    <group>
      <Room at={DADDY} w={4} d={3.6} floor="#a7764a" wall="#efe2c9" low={['front', 'right']} />
      <Window at={local(DADDY, -1, 0.7, -1.75)} night={night} />
      <Model
        url={MODEL.furniture('rugRectangle')}
        position={local(DADDY, 0.1, 0.04, 0)}
        scale={1.2}
      />
      {daddy.aid !== 'wheelchair' && (
        <Model
          url={MODEL.furniture('loungeChairRelax')}
          position={SPOT.daddyChair}
          rotation={[0, FACE.away, 0]}
        />
      )}
      <Model
        url={MODEL.furniture('sideTable')}
        position={local(DADDY, 0.95, 0.04, 0.45)}
        rotation={[0, Math.PI / 2, 0]}
      />
      <Model url={MODEL.furniture('cabinetTelevision')} position={local(DADDY, 0, 0.04, -1.6)} />
      <Model
        url={MODEL.furniture('loungeSofa')}
        position={local(DADDY, -1.35, 0.04, 0.2)}
        rotation={[0, FACE.right, 0]}
      />
      <Model
        url={MODEL.furniture('bookcaseOpen')}
        position={local(DADDY, -1.75, 0.04, -1.45)}
        rotation={[0, FACE.right, 0]}
      />
      <Model url={MODEL.furniture('pottedPlant')} position={local(DADDY, 1.7, 0.04, -1.5)} />
      <Model url={MODEL.furniture('lampRoundFloor')} position={local(DADDY, -1.7, 0.04, 1.3)} />
      <Lamp at={local(DADDY, -0.6, 1.0, 0.4)} night={night} />
      {/* the front door, with the doorbell beside it */}
      <group position={local(DADDY, 1.6, 0, 1.8)}>
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} castShadow position={[x, 0.55, 0]}>
            <boxGeometry args={[0.06, 1.1, 0.1]} />
            <meshStandardMaterial color="#6b4a2e" />
          </mesh>
        ))}
        <mesh castShadow position={[0, 1.12, 0]}>
          <boxGeometry args={[0.66, 0.06, 0.1]} />
          <meshStandardMaterial color="#6b4a2e" />
        </mesh>
        <mesh position={[0.24, 0.52, -0.25]} rotation={[0, -1.2, 0]}>
          <boxGeometry args={[0.54, 1.04, 0.04]} />
          <meshStandardMaterial color="#8a5a34" />
        </mesh>
      </group>
      <Doorbell position={DEVICE.doorbell} active={view.ringActive} />
      <Echo position={DEVICE.daddyEcho} glow={view.glow.daddy} scale={1.3} />
      <FireTV position={DEVICE.daddyTv} src="/tv" frameId="world-tv" width={0.66} />
      <CityLabel at={local(DADDY, 0, 3.1, 0)} which="home" />
      <group position={SPOT.daddyChair}>
        <PhoneBubble
          who="daddy"
          message={view.phones.daddy}
          listening={view.phoneListening === 'daddy'}
        />
      </group>
      {/* Whoever is cared for moves at their own pace: slowly after eye surgery, steadily in a chair. */}
      <Character
        model={daddy.model}
        anim={view.people.daddy!.at === 'door' ? 'idle' : 'sit'}
        position={daddySpot(view.people.daddy!.at)}
        facing={view.people.daddy!.at === 'door' ? FACE.toward : FACE.away}
        scale={PERSON_SCALE}
        aid={daddy.aid}
        speed={0.5}
        {...alive('daddy', view.people)}
      />
      {view.people.daddy!.look === 'tv' && view.people.daddy!.at !== 'door' && (
        <HeldRemote
          at={local(daddySpot(view.people.daddy!.at), 0.16, 0.5, -0.3)}
          press={view.press}
        />
      )}
    </group>
  );
}

/** Where each button sits on the remote's face, as on a Fire TV remote: the ring, OK, back. */
const BUTTON: Record<string, [number, number]> = {
  up: [0, 0.045],
  down: [0, -0.005],
  left: [-0.025, 0.02],
  right: [0.025, 0.02],
  ok: [0, 0.02],
  back: [-0.02, -0.04],
};

/**
 * The remote in their hand while they are at the TV. The button they press lights, and a
 * short beam goes to the set, so a press is seen in the room as well as on the screen.
 */
function HeldRemote({ at, press }: { at: V3; press: WorldView['press'] }) {
  const lit = useRef<THREE.MeshStandardMaterial>(null);
  const beam = useRef<THREE.Mesh>(null);
  const since = useRef(99);
  useEffect(() => {
    if (press) since.current = 0;
  }, [press?.n]);
  useFrame((_, dt) => {
    since.current += dt;
    const on = Math.max(0, 1 - since.current / 0.5);
    if (lit.current) lit.current.emissiveIntensity = 0.2 + on * 3;
    if (beam.current) {
      beam.current.visible = on > 0;
      (beam.current.material as THREE.MeshBasicMaterial).opacity = on * 0.8;
    }
  });
  const [bx, by] = BUTTON[press?.key ?? 'ok'] ?? BUTTON.ok!;
  // From the remote's tip to the TV, in the remote's own frame.
  const to = new THREE.Vector3(...DEVICE.daddyTv).sub(new THREE.Vector3(...at));
  const len = to.length();
  const dir = to.clone().normalize();
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return (
    <group position={at}>
      <group rotation={[-1.1, 0, 0]} scale={1.6}>
        <mesh castShadow>
          <boxGeometry args={[0.07, 0.17, 0.02]} />
          <meshStandardMaterial color="#1c1c1e" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.02, 0.011]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.025, 0.006, 8, 24]} />
          <meshStandardMaterial color="#3a3a3c" />
        </mesh>
        {Object.entries(BUTTON)
          .filter(([k]) => k === 'ok' || k === 'back')
          .map(([k, [x, y]]) => (
            <mesh key={k} position={[x, y, 0.012]}>
              <cylinderGeometry args={[0.009, 0.009, 0.006, 16]} />
              <meshStandardMaterial color="#48484a" />
            </mesh>
          ))}
        <mesh position={[bx, by, 0.016]}>
          <sphereGeometry args={[0.009, 12, 12]} />
          <meshStandardMaterial
            ref={lit}
            color="#00caff"
            emissive="#00caff"
            emissiveIntensity={0.2}
            toneMapped={false}
          />
        </mesh>
      </group>
      <mesh
        ref={beam}
        visible={false}
        position={dir
          .clone()
          .multiplyScalar(len / 2)
          .toArray()}
        quaternion={tilt}
      >
        <cylinderGeometry args={[0.006, 0.006, len, 6]} />
        <meshBasicMaterial color="#00caff" transparent opacity={0} toneMapped={false} />
      </mesh>
    </group>
  );
}

function ToluFlat({ view, night }: { view: WorldView; night: boolean }) {
  const tolu = CAST.tolu!;
  return (
    <group>
      <Room at={TOLU} w={3.6} d={3.2} floor="#8b9196" wall="#dfe7ee" low={['front', 'left']} />
      <CityLabel at={local(TOLU, 0, 3.0, 0)} which="tolu" />
      <Window at={local(TOLU, 0.7, 0.7, -1.55)} night={night} w={1.2} />
      <Model url={MODEL.furniture('rugRectangle')} position={local(TOLU, 0, 0.04, 0.4)} />
      <Model url={MODEL.furniture('desk')} position={local(TOLU, 0, 0.04, -0.95)} />
      <Model
        url={MODEL.furniture('laptop')}
        position={local(TOLU, -0.1, 0.42, -0.95)}
        scale={0.6}
      />
      <Model
        url={MODEL.furniture('chairDesk')}
        position={SPOT.toluDesk}
        rotation={[0, FACE.away, 0]}
      />
      <Model
        url={MODEL.furniture('loungeSofa')}
        position={local(TOLU, 1.3, 0.04, 0.6)}
        rotation={[0, FACE.left, 0]}
      />
      <Model
        url={MODEL.furniture('bookcaseOpen')}
        position={local(TOLU, -1.6, 0.04, -1.3)}
        rotation={[0, FACE.right, 0]}
      />
      <Model url={MODEL.furniture('pottedPlant')} position={local(TOLU, 1.55, 0.04, -1.3)} />
      <Lamp at={local(TOLU, 0, 1.0, 0)} night={night} />
      <Echo position={DEVICE.toluEcho} glow={view.glow.tolu} scale={1.3} />
      <group position={SPOT.toluDesk}>
        <PhoneBubble
          who="tolu"
          message={view.phones.tolu}
          listening={view.phoneListening === 'tolu'}
        />
      </group>
      <Character
        model={tolu.model}
        anim="sit"
        position={local(SPOT.toluDesk, 0, 0.1, 0)}
        facing={FACE.away}
        scale={PERSON_SCALE}
        {...alive('tolu', view.people)}
        typing={view.people.tolu!.look === 'laptop'}
      />
    </group>
  );
}

/**
 * When a family is not all in one city, each home says where it is. The street between them
 * stands for the two hours of road: the world is a stage, not a map.
 */
function CityLabel({ at, which }: { at: V3; which: 'home' | 'tolu' }) {
  const places = family().places;
  if (!places) return null;
  return (
    <Html position={at} center pointerEvents="none" zIndexRange={[5, 0]}>
      <div className="world-label city">{places[which]}</div>
    </Html>
  );
}

function Pharmacy({ night }: { night: boolean }) {
  return (
    <group position={PHARMACY}>
      <Model url={MODEL.suburban('building-type-c')} rotation={[0, Math.PI, 0]} scale={2.3} />
      {/* the green cross, lit */}
      <group position={[0, 1.55, -1.27]}>
        <mesh>
          <boxGeometry args={[0.5, 0.15, 0.05]} />
          <meshStandardMaterial
            color="#1b9e4b"
            emissive="#22d36a"
            emissiveIntensity={night ? 2.5 : 0.8}
            toneMapped={false}
          />
        </mesh>
        <mesh>
          <boxGeometry args={[0.15, 0.5, 0.05]} />
          <meshStandardMaterial
            color="#1b9e4b"
            emissive="#22d36a"
            emissiveIntensity={night ? 2.5 : 0.8}
            toneMapped={false}
          />
        </mesh>
      </group>
      <pointLight
        position={[0, 1.2, -1.9]}
        color="#9fffc4"
        intensity={night ? 1.5 : 0}
        distance={4}
      />
      <Html position={[0, 2.5, -1.2]} center pointerEvents="none" zIndexRange={[5, 0]}>
        <div className="world-label">Pharmacy</div>
      </Html>
    </group>
  );
}

/**
 * Musa's evening, as the story moves him: he drives, he walks, he rings a bell. Each stage
 * is a little sequence of moves, so the car is never somewhere he isn't.
 */
function MusaRig({
  stage,
  phone,
  listening,
  life,
}: {
  stage: Stage;
  phone?: { from: string; text: string; key: string };
  listening: boolean;
  life: ReturnType<typeof alive>;
}) {
  const musa = CAST.musa!;
  const [car, setCar] = useState<V3>(CAR.midday);
  const [me, setMe] = useState<{ at: V3; anim: Anim; shown: boolean; facing: number }>({
    at: SPOT.musaCarMidday,
    anim: 'idle',
    shown: true,
    facing: FACE.left,
  });
  const token = useRef(0);

  useEffect(() => {
    const t = ++token.current;
    const live = () => token.current === t;
    const beside = (c: V3, side = -0.75): V3 => [c[0], 0, c[2] + side];
    const walk = async (at: V3, anim: Anim = 'idle', facing = 0) => {
      setMe((m) => ({ ...m, at, anim, shown: true, facing }));
      await wait(1400);
    };
    const drive = async (to: V3) => {
      setMe((m) => ({ ...m, shown: false }));
      setCar(to);
      await wait(2200);
    };
    void (async () => {
      switch (stage) {
        case 'midday':
          setCar(CAR.midday);
          setMe({ at: SPOT.musaCarMidday, anim: 'idle', shown: true, facing: FACE.left });
          break;
        case 'pharmacy':
          await drive(CAR.pharmacy);
          if (!live()) return;
          setMe({ at: beside(CAR.pharmacy, 0.75), anim: 'idle', shown: true, facing: FACE.toward });
          await wait(200);
          if (!live()) return;
          await walk(SPOT.musaPharmacy, 'interact-right', FACE.toward);
          break;
        case 'driving':
          await walk(beside(CAR.pharmacy, 0.75));
          if (!live()) return;
          await drive(CAR.daddy);
          break;
        case 'atDoor':
          setMe({ at: beside(CAR.daddy), anim: 'idle', shown: true, facing: FACE.away });
          await wait(200);
          if (!live()) return;
          await walk(SPOT.musaDoorPath, 'walk', FACE.away);
          if (!live()) return;
          await walk(SPOT.musaAtDoor, 'interact-right', FACE.away);
          break;
        case 'backInCar':
          await walk(beside(CAR.daddy));
          if (!live()) return;
          await drive(CAR.midday);
          if (!live()) return;
          setMe({ at: SPOT.musaCarMidday, anim: 'idle', shown: true, facing: FACE.left });
          break;
      }
    })();
  }, [stage]);

  return (
    <group>
      <Car to={car} />
      <Character
        model={musa.model}
        anim={me.anim}
        position={me.at}
        facing={me.facing}
        scale={PERSON_SCALE}
        visible={me.shown}
        speed={1.4}
        {...life}
      />
      <MovingLabel at={me.at}>
        <PhoneBubble who="musa" message={phone} listening={listening} />
      </MovingLabel>
    </group>
  );
}

/** A label that follows a walking person (eased, as they walk). */
function MovingLabel({ at, children }: { at: V3; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Vector3(...at), [at[0], at[1], at[2]]);
  useEffect(() => {
    g.current?.position.copy(target); /* eslint-disable-next-line */
  }, []);
  useFrame((_, dt) => {
    const p = g.current?.position;
    if (!p) return;
    const d = target.clone().sub(p);
    p.add(d.multiplyScalar(Math.min(1, dt * 2.2)));
  });
  return <group ref={g}>{children}</group>;
}

/** Musa's car drives along the road to wherever the story needs it. */
function Car({ to }: { to: V3 }) {
  const g = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Vector3(...to), [to[0], to[1], to[2]]);
  useEffect(() => {
    g.current?.position.copy(target);
    if (g.current) g.current.rotation.y = -Math.PI / 2; /* eslint-disable-next-line */
  }, []);
  useFrame((_, dt) => {
    const car = g.current;
    if (!car) return;
    const d = target.clone().sub(car.position);
    const len = d.length();
    if (len < 0.01) return;
    const step = Math.min(len, Math.max(0.4, Math.min(4, len * 1.8)) * dt);
    car.position.add(d.normalize().multiplyScalar(step));
    const heading = Math.atan2(d.x, d.z);
    const diff = Math.atan2(Math.sin(heading - car.rotation.y), Math.cos(heading - car.rotation.y));
    if (len > 0.15) car.rotation.y += diff * Math.min(1, dt * 5);
  });
  return (
    <group ref={g}>
      <Model url={MODEL.car('sedan')} scale={0.5} tint={undefined} />
    </group>
  );
}
