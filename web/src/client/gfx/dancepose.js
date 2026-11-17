// Emote dance animations for the operator rig (models.js). Each dance is a function of the beat (float, from the
// dance's BPM) returning a pose; applyDancePose() writes it onto the rig.
//
// Pose: { y, lean, yaw, roll, head: [x, y, z], L/R: [swing, twist, out, elbow, elbowOut], lL/lR: [swing, out, knee] }
//   swing: arm/leg forward (+) and up; out: away from the body sideways; elbow / knee: bend in radians.
const TAU = Math.PI * 2;
const sin = (x) => Math.sin(x);
const pos = (x) => Math.max(0, x);
/** 0 -> 1 quickly at the start of each beat, for snappy "robot" moves. */
const snap = (b) => { const f = b - Math.floor(b); return f < 0.18 ? (f / 0.18) * (f / 0.18) * (3 - 2 * (f / 0.18)) : 1; };
const mix = (a, b, k) => a + (b - a) * k;
const mixArm = (a, b, k) => a.map((v, i) => mix(v, b[i] || 0, k));

const DOWN = [0.05, 0, 0.12, 0.15, 0];

const smooth = (k) => k * k * (3 - 2 * k);
const mixPose = (a, b, k) => ({
  y: mix(a.y, b.y, k), lean: mix(a.lean, b.lean, k), yaw: mix(a.yaw, b.yaw, k), roll: mix(a.roll, b.roll, k),
  head: a.head.map((v, i) => mix(v, b.head[i], k)), L: mixArm(a.L, b.L, k), R: mixArm(a.R, b.R, k),
  lL: a.lL.map((v, i) => mix(v, b.lL[i], k)), lR: a.lR.map((v, i) => mix(v, b.lR[i], k)),
});
/** 1 right on each beat, falling to 0 between beats (claps, pumps). */
const onBeat = (b) => { const f = b - Math.floor(b); return Math.exp(-f * f * 55) + Math.exp(-(1 - f) * (1 - f) * 55); };
/** Knees dip on every beat. */
const dip = (b) => 0.5 + 0.5 * Math.cos(b * TAU);

const CREW = [
  // 1. Step-touch side to side, clapping in front of the chest on every beat.
  (b) => {
    const side = sin(b * Math.PI);
    const clap = onBeat(b);
    return {
      y: -0.05 * dip(b), lean: 0.04, yaw: 0.12 * side, roll: 0.07 * side,
      head: [0.1 * dip(b), 0.15 * side, 0],
      L: [1.25, 0, 0.55 - 0.5 * clap, 0.7, 0], R: [1.25, 0, 0.55 - 0.5 * clap, 0.7, 0],
      lL: [0.05, 0.08 + 0.22 * pos(side), 0.2 + 0.25 * dip(b)], lR: [0.05, 0.08 + 0.22 * pos(-side), 0.2 + 0.25 * dip(b)],
    };
  },
  // 2. Arm roll in front of the chest, swaying the shoulders.
  (b) => {
    const r = b * TAU;
    return {
      y: -0.04 * dip(b), lean: 0.08, yaw: 0.28 * sin(b * Math.PI * 0.5), roll: 0.05 * sin(b * Math.PI),
      head: [0.12 * dip(b), -0.15 * sin(b * Math.PI * 0.5), 0],
      L: [0.95 + 0.3 * sin(r), 0, 0.25, 1.7 + 0.35 * Math.cos(r), 0], R: [0.95 + 0.3 * sin(r + Math.PI), 0, 0.25, 1.7 + 0.35 * Math.cos(r + Math.PI), 0],
      lL: [0, 0.12, 0.25 + 0.2 * dip(b)], lR: [0, 0.12, 0.25 + 0.2 * dip(b)],
    };
  },
  // 3. Point up to the left, then the right, other hand on the hip, hip pop on each point.
  (b) => {
    const k = snap(b);
    const right = Math.floor(b) % 2 === 1;
    const point = [2.45, 0, 0.75, 0, 0], hip = [-0.25, 0, 0.6, 1.75, 0];
    const L = right ? mixArm(point, hip, k) : mixArm(hip, point, k);
    const R = right ? mixArm(hip, point, k) : mixArm(point, hip, k);
    const s = right ? mix(1, -1, k) : mix(-1, 1, k);
    return {
      y: -0.03 * (1 - k), lean: 0, yaw: -0.3 * s, roll: -0.1 * s,
      head: [-0.15, -0.35 * s, 0],
      L, R,
      lL: [0, 0.12 + 0.12 * pos(-s), 0.15 + 0.2 * pos(s)], lR: [0, 0.12 + 0.12 * pos(s), 0.15 + 0.2 * pos(-s)],
    };
  },
  // 4. Raise the roof: palms push up on the beat while hopping.
  (b) => {
    const push = onBeat(b);
    const hop = pos(sin(b * TAU));
    return {
      y: 0.09 * hop - 0.03 * push, lean: -0.05, yaw: 0.15 * sin(b * Math.PI * 0.5), roll: 0,
      head: [-0.2, 0, 0.12 * sin(b * Math.PI)],
      L: [2.5 + 0.35 * push, 0, 0.55, 1.4 - 1.1 * push, 0], R: [2.5 + 0.35 * push, 0, 0.55, 1.4 - 1.1 * push, 0],
      lL: [0.15 * hop, 0.1, 0.2 + 0.55 * hop], lR: [0.15 * hop, 0.1, 0.2 + 0.55 * hop],
    };
  },
];

const POSES = {
  robot(b) {
    const step = Math.floor(b) % 4, prev = (step + 3) % 4, k = snap(b);
    const arms = [
      [[1.57, 0, 0.1, 1.57, 0], [0.15, 0, 0.12, 0.1, 0]],   // left forearm up
      [[0.15, 0, 0.12, 0.1, 0], [1.57, 0, 0.1, 1.57, 0]],   // right forearm up
      [[1.57, 0, 0.05, 0, 0], [1.57, 0, 0.05, 0, 0]],       // both straight forward
      [[0.2, 0, 1.4, 0, 0], [0.2, 0, 1.4, 0, 0]],           // both out to the sides
    ];
    const heads = [0.45, -0.45, 0, 0];
    const yaws = [0.25, -0.25, 0, 0];
    return {
      y: -0.03 * (1 - k), lean: 0, yaw: mix(yaws[prev], yaws[step], k), roll: 0,
      head: [0, mix(heads[prev], heads[step], k), 0],
      L: mixArm(arms[prev][0], arms[step][0], k), R: mixArm(arms[prev][1], arms[step][1], k),
      lL: [0, 0.05, 0.12 * (1 - k)], lR: [0, 0.05, 0.12 * (1 - k)],
    };
  },
  disco(b) {
    const up = Math.floor(b) % 2 === 0;
    const k = snap(b);
    const point = up ? [2.6, 0, 0.55, 0, 0] : [0.45, 0, -0.35, 0.1, 0];
    const from = up ? [0.45, 0, -0.35, 0.1, 0] : [2.6, 0, 0.55, 0, 0];
    const sway = sin(b * Math.PI);
    return {
      y: -0.03 * Math.abs(sway), lean: 0.03, yaw: 0.15 * sway, roll: 0.07 * sway,
      head: [up ? 0.25 : -0.15, 0.2 * sway, 0],
      L: [-0.15, 0, 0.65, 1.9, 0], R: mixArm(from, point, k),
      lL: [0.05, 0.12, up ? 0.35 : 0.05], lR: [0.05, 0.12, up ? 0.05 : 0.35],
    };
  },
  guitar(b) {
    const strum = sin(b * TAU * 2);
    const bang = Math.abs(sin(b * Math.PI));
    return {
      y: -0.1 - 0.04 * bang, lean: -0.16, yaw: -0.2, roll: 0.04 * sin(b * Math.PI),
      head: [0.15 - 0.45 * bang, 0.15, 0],
      L: [1.25, 0, 0.4, 0.55, 0], R: [0.55 + 0.28 * strum, 0, 0.2, 1.5, 0],
      lL: [0.15, 0.35, 0.4], lR: [-0.1, 0.35, 0.4],
    };
  },
  chicken(b) {
    const flap = Math.abs(sin(b * TAU));
    const peck = pos(sin(b * TAU));
    const stepL = pos(sin(b * Math.PI)), stepR = pos(-sin(b * Math.PI));
    return {
      y: -0.06 + 0.04 * flap, lean: 0.28, yaw: 0, roll: 0.06 * sin(b * Math.PI),
      head: [-0.55 * peck + 0.2, 0, 0],
      L: [-0.25, 0, 0.45 + 0.6 * flap, 2.3, 0], R: [-0.25, 0, 0.45 + 0.6 * flap, 2.3, 0],
      lL: [0.7 * stepL, 0.08, 1.1 * stepL + 0.2], lR: [0.7 * stepR, 0.08, 1.1 * stepR + 0.2],
    };
  },
  spin(b) {
    const hop = Math.floor(b) % 4 === 3 ? pos(sin((b % 1) * Math.PI)) : 0;
    return {
      y: 0.18 * hop, lean: 0, yaw: b * Math.PI, roll: 0,
      head: [0.15, 0, 0],
      L: [0.25, 0, 1.45, 0.1, 0], R: [0.25, 0, 1.45, 0.1, 0],
      lL: [0, 0.03, 0.05], lR: [0.55, 0.05, 1.5],
    };
  },
  victory(b) {
    const air = Math.abs(sin(b * Math.PI));
    const left = Math.floor(b) % 2 === 0;
    const up = [2.95, 0, 0.15, 0.15, 0], mid = [2.1, 0, 0.35, 1.1, 0];
    return {
      y: 0.24 * air, lean: 0, yaw: 0, roll: 0,
      head: [0.35, 0, 0],
      L: left ? up : mid, R: left ? mid : up,
      lL: [0.35 * air, 0.06, 0.8 * air], lR: [0.35 * air, 0.06, 0.8 * air],
    };
  },
  shuffle(b) {
    const s = sin(b * Math.PI);
    const bounce = Math.abs(sin(b * TAU));
    return {
      y: -0.05 * bounce, lean: 0.06, yaw: 0.25 * sin(b * Math.PI * 0.5), roll: 0,
      head: [0.1 * bounce, 0, 0],
      L: [-0.6 * s, 0, 0.2, 1.2, 0], R: [0.6 * s, 0, 0.2, 1.2, 0],
      lL: [0.6 * s, 0.22, 0.3 + 0.35 * pos(s)], lR: [-0.6 * s, 0.22, 0.3 + 0.35 * pos(-s)],
    };
  },
  wave(b) {
    const ph = b * Math.PI;
    return {
      y: -0.04, lean: 0, yaw: 0.12 * sin(ph * 0.5), roll: 0.08 * sin(ph + 0.9),
      head: [0, 0, 0.18 * sin(ph + 0.9)],
      L: [0.1, 0, 1.45 + 0.35 * sin(ph), 0, 0.7 * sin(ph - 0.7)],
      R: [0.1, 0, 1.45 + 0.35 * sin(ph + 1.8), 0, 0.7 * sin(ph + 1.1)],
      lL: [0, 0.1, 0.25 + 0.12 * sin(ph)], lR: [0, 0.1, 0.25 + 0.12 * sin(ph + Math.PI)],
    };
  },
  // Crew Groove (group dance): a 16-beat routine in four parts, so a crew dancing it together looks rehearsed:
  // step-touch with claps, arm rolls, point left / right, then raise the roof with hops.
  crew(b) {
    const part = Math.floor(b / 4) % 4;
    const local = b - Math.floor(b / 4) * 4;
    const p = CREW[part](b);
    // Blend into the next part over the last quarter beat.
    if (local < 3.75) return p;
    return mixPose(p, CREW[(part + 1) % 4](b), smooth((local - 3.75) / 0.25));
  },
};

/** Pose for a dance at a time (seconds since it started). */
export function dancePose(id, seconds, bpm, shownFor = seconds) {
  const f = POSES[id] || POSES.robot;
  const p = f((seconds * bpm) / 60);
  // Ease in over the first 0.3 s from standing (also when joining a group dance halfway through the routine).
  const k = Math.min(1, Math.max(0, shownFor) / 0.3);
  if (k >= 1) return p;
  const z = (v) => v * k;
  return {
    y: z(p.y), lean: z(p.lean), yaw: z(p.yaw), roll: z(p.roll), head: p.head.map(z),
    L: mixArm(DOWN, p.L, k), R: mixArm(DOWN, p.R, k), lL: p.lL.map(z), lR: p.lR.map(z),
  };
}

/** Writes a pose onto an operator rig (see buildOperator). */
export function applyDancePose(m, p) {
  m.body.position.y = p.y;
  m.body.rotation.set(-p.lean, p.yaw, p.roll);
  m.headPivot.rotation.set(p.head[0], p.head[1], p.head[2]);
  m.shoulderL.rotation.set(p.L[0], p.L[1], -p.L[2]);
  m.elbowL.rotation.set(p.L[3], 0, -(p.L[4] || 0));
  m.shoulderR.rotation.set(p.R[0], -p.R[1], p.R[2]);
  m.elbowR.rotation.set(p.R[3], 0, p.R[4] || 0);
  m.legL.rotation.set(p.lL[0], 0, -p.lL[1]);
  m.kneeL.rotation.x = -p.lL[2];
  m.legR.rotation.set(p.lR[0], 0, p.lR[1]);
  m.kneeR.rotation.x = -p.lR[2];
}

/** Puts the rig back to its normal (gun-holding) state after a dance. */
export function clearDancePose(m) {
  m.body.rotation.set(0, 0, 0);
  m.headPivot.rotation.set(0, 0, 0);
  m.legL.rotation.set(0, 0, 0);
  m.legR.rotation.set(0, 0, 0);
  m.kneeL.rotation.x = 0;
  m.kneeR.rotation.x = 0;
}
