import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { drawArrow, resultant } from '@shared/lib/vectorArrow';

/**
 * D09 · Free-Body Diagram Builder — L9 (fbd), L10 (pairs).
 *
 * The most UI-heavy demo in the set: the student *builds* a free-body diagram by
 * dragging force vectors out of a palette onto a body, then aims each one by
 * dragging its tip. There is no numerical simulation — the physics lives in the
 * scene definitions (what forces *should* be on the body, and, for Newton's
 * third law, which force on one body pairs with which force on the other).
 *
 *   fbd   : pick a scene, drop the forces you think act on the highlighted body,
 *           aim each one, and read the live net force (ΣFx, ΣFy, |F|, θ). The
 *           "Check" button gives specific physics feedback — not a red X — e.g.
 *           "your normal force points straight up, but the surface is inclined"
 *           or "you're missing friction."
 *
 *   pairs : the diagrams come pre-drawn on BOTH bodies. Click any force and its
 *           Newton's-third-law partner lights up ON THE OTHER BODY (equal size,
 *           opposite direction, different body). The stacked-blocks scene is the
 *           discriminator — forces ON block A vs BY block A — and the horse-and-
 *           cart scene is THE MOMENT: action and reaction act on different bodies,
 *           so they can never cancel each other, yet the cart still accelerates.
 *
 * Screen convention (matches vectorArrow.js): +x right, +y DOWN in canvas px.
 * Force "angle" is stored in physics convention (+y up, degrees CCW from +x)
 * and negated on dy at draw time.
 *
 * ── PHYSICS FIX (this pass) ─────────────────────────────────────────────────
 * Previously every palette force used a fixed default magnitude (weight 90,
 * normal 90, friction 60, tension 80). On the incline that meant a diagram with
 * "correct" DIRECTIONS still had W=90 down but N=90 perpendicular and f=60 up-
 * slope — which does NOT sum to zero, so a correct static answer displayed a
 * spurious net force. That literally teaches the wrong lesson (a valid static
 * FBD must close).
 *
 * The fix: each scene derives the CORRECT magnitude of every force it expects
 * from a single weight scale W (see `expectedForces(scene, W)`):
 *   table / stacked / tug : N = W               (level surface)
 *   incline               : N = W·cosθ, f = W·sinθ   (θ = live surfaceAngle)
 *   tug                   : the two rope tensions are equal (cancel)
 *   horse-cart            : T (forward) = f (backward), N = W
 * When a force is dropped from the palette we look up its expected magnitude for
 * the current scene so a correctly-aimed diagram visibly closes to ΣF ≈ 0. The
 * student can still re-aim (and stretch) each arrow by dragging its tip; the
 * equilibrium meter then reports how far the diagram is from balance.
 *
 * Enhancements added: equilibrium meter + body drift, tip-to-tail force-polygon
 * toggle, "Show me" ghost of the target forces after Check, and a live incline-
 * angle slider that turns the one incline scene into a whole family.
 *
 * Kept the default export a thin, hook-free wrapper that branches on mode; each
 * child owns its own hooks (Rules of Hooks).
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* palette + colors                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

const GOLD = '#C5B783';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const DEEP = '#0D1321';
const GREEN = '#7FB77E';

// Reference weight magnitude in palette pixels. Every "correct" magnitude in a
// scene is derived from this so the numbers are self-consistent and, when a
// diagram is right, they cancel. It is also the length of a full weight arrow.
const W_SCALE = 96;

// Every force type the palette can dispense. `angle` is the default aim in
// physics degrees (0 = +x/right, 90 = +y/up). `mag` here is only a fallback for
// scenes that do not specify an expected magnitude; scenes normally override it
// via expectedForces().
const FORCE_TYPES = {
  weight: { label: 'Weight', sym: 'W', color: '#5B9BD5', angle: -90, mag: W_SCALE, hint: 'Gravity — always straight down.' },
  normal: { label: 'Normal', sym: 'N', color: GREEN, angle: 90, mag: W_SCALE, hint: 'Surface push — perpendicular to the surface.' },
  tension: { label: 'Tension', sym: 'T', color: GOLD, angle: 0, mag: W_SCALE, hint: 'Pull along a rope, away from the body.' },
  friction: { label: 'Friction', sym: 'f', color: '#D98C5F', angle: 180, mag: W_SCALE * 0.6, hint: 'Along the surface, opposing relative slip.' },
  applied: { label: 'Applied', sym: 'F', color: '#C58BD9', angle: 0, mag: W_SCALE * 0.8, hint: 'A push or pull you apply directly.' },
};
const TYPE_ORDER = ['weight', 'normal', 'tension', 'friction', 'applied'];

// Convert a physics angle (deg, +y up) + magnitude (px) to canvas (dx, dy, +y down).
function polar(angleDeg, mag) {
  const r = (angleDeg * Math.PI) / 180;
  return { dx: Math.cos(r) * mag, dy: -Math.sin(r) * mag };
}
// Inverse: canvas (dx,dy) → physics angle in degrees.
function angleOf(dx, dy) {
  return (Math.atan2(-dy, dx) * 180) / Math.PI;
}
// Smallest absolute difference between two angles, in degrees (0..180).
function angleDiff(a, b) {
  let d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* scene library                                                               */
/* ────────────────────────────────────────────────────────────────────────── */
/*
 * Bodies carry a normalized-ish canvas layout (fractions of W/H) plus a draw
 * kind. `correct(theta)` (fbd mode) RETURNS the forces that genuinely act on the
 * target body for the current incline angle θ — each with an expected physics
 * angle AND an expected magnitude derived from the scene, so a correct answer
 * closes. `preplaced` (pairs mode) is the finished diagram on every body, and
 * `partners` maps a force id to its 3rd-law partner.
 */

const SCENES = {
  table: {
    label: 'Block on a table',
    surfaceAngle: 0,          // horizontal (fixed)
    inclineAdjustable: false,
    target: 'block',
    bodies: {
      block: { label: 'Block', kind: 'block', x: 0.5, y: 0.52, w: 0.2, h: 0.16 },
    },
    // fbd: the two forces that act on a block resting on a level table.
    // N = W so the pair cancels → ΣF = 0.
    correct: () => [
      { type: 'weight', angle: -90, mag: W_SCALE, why: 'Weight pulls straight down (mg).' },
      { type: 'normal', angle: 90, mag: W_SCALE, why: 'On a level table the normal force is straight up, equal to the weight.' },
    ],
    pairsGroups: ['table'],
  },

  incline: {
    label: 'Block on an incline',
    surfaceAngle: 28,         // deg above horizontal (ramp rises to the right) — DEFAULT; adjustable
    inclineAdjustable: true,
    target: 'block',
    bodies: {
      block: { label: 'Block', kind: 'incline-block', x: 0.5, y: 0.5, w: 0.2, h: 0.14 },
    },
    // A block held static on a frictional ramp: W down, N = W·cosθ perpendicular
    // to the face, f = W·sinθ up the slope. Those three close to ΣF = 0.
    correct: (theta) => {
      const rad = (theta * Math.PI) / 180;
      return [
        { type: 'weight', angle: -90, mag: W_SCALE, why: 'Weight is ALWAYS straight down, regardless of the ramp.' },
        { type: 'normal', angle: 90 + theta, mag: W_SCALE * Math.cos(rad), why: `Normal is perpendicular to the incline face (N = W·cos ${Math.round(theta)}°), not vertical.` },
        { type: 'friction', angle: theta, mag: W_SCALE * Math.sin(rad), why: `Static friction acts up the slope with magnitude W·sin ${Math.round(theta)}°, opposing the tendency to slide down.` },
      ];
    },
    pairsGroups: ['incline'],
  },

  tug: {
    label: 'Tug-of-war (rope + block)',
    surfaceAngle: 0,
    inclineAdjustable: false,
    target: 'block',
    bodies: {
      block: { label: 'Crate', kind: 'block', x: 0.5, y: 0.55, w: 0.18, h: 0.18 },
    },
    // Balanced tug: two equal, opposite tensions cancel; W and N cancel.
    correct: () => [
      { type: 'weight', angle: -90, mag: W_SCALE, why: 'Weight straight down.' },
      { type: 'normal', angle: 90, mag: W_SCALE, why: 'Normal straight up from the ground, equal to the weight.' },
      { type: 'tension', angle: 0, mag: W_SCALE * 0.7, why: 'Rope tension pulls the crate to the right.' },
      { type: 'tension', angle: 180, mag: W_SCALE * 0.7, why: 'The other team pulls the crate to the left with an equal tension.' },
    ],
    pairsGroups: ['tug'],
  },

  stacked: {
    label: 'Stacked blocks (A on B)',
    surfaceAngle: 0,
    inclineAdjustable: false,
    target: 'blockA',
    bodies: {
      blockA: { label: 'Block A (top)', kind: 'block', x: 0.5, y: 0.4, w: 0.22, h: 0.14 },
      blockB: { label: 'Block B (bottom)', kind: 'block', x: 0.5, y: 0.56, w: 0.3, h: 0.16 },
    },
    // fbd target is A (the top block): only its weight and B's push on it.
    // N (from B) = W_A → cancels.
    correct: () => [
      { type: 'weight', angle: -90, mag: W_SCALE, why: "A's weight pulls it down." },
      { type: 'normal', angle: 90, mag: W_SCALE, why: 'Block B pushes UP on A (its normal force), equal to A\'s weight. This is the force ON A, by B.' },
    ],
    pairsGroups: ['stacked'],
  },

  horsecart: {
    label: 'Horse & cart (THE paradox)',
    surfaceAngle: 0,
    inclineAdjustable: false,
    target: 'cart',
    bodies: {
      horse: { label: 'Horse', kind: 'horse', x: 0.34, y: 0.52, w: 0.22, h: 0.22 },
      cart: { label: 'Cart', kind: 'cart', x: 0.66, y: 0.54, w: 0.22, h: 0.16 },
    },
    // fbd target = cart at constant velocity: T forward balances f backward,
    // N balances W → the cart's own FBD closes (Newton's first law).
    correct: () => [
      { type: 'weight', angle: -90, mag: W_SCALE, why: 'Cart weight down.' },
      { type: 'normal', angle: 90, mag: W_SCALE, why: 'Ground normal up, equal to the weight.' },
      { type: 'tension', angle: 0, mag: W_SCALE * 0.65, why: 'The harness/rope tension pulls the cart forward.' },
      { type: 'friction', angle: 180, mag: W_SCALE * 0.65, why: 'Rolling/ground friction opposes the motion, backward, and (at steady speed) matches the tension.' },
    ],
    pairsGroups: ['horsecart'],
  },
};

// Resolve a scene's expected forces for the current (possibly live) incline angle.
function expectedForces(scene, theta) {
  return scene.correct(theta);
}

/* ── pairs-mode diagrams (pre-placed forces + 3rd-law partner map) ──────────
 * Each entry: { forces: [{id, body, type, angle, label}], partners: {id:id} }
 * `body` refers to a key in the scene's bodies map. Partner links are symmetric
 * and always cross bodies (that is the whole point of Newton's third law).
 */
const PAIR_INCLINE_ANGLE = 28; // pairs mode uses the fixed illustrative angle
const PAIR_SCENES = {
  table: {
    // Only the contact pair is a true 3rd-law pair. Weight's partner (Earth) is
    // off-screen, so we note it in text rather than drawing a partner arrow.
    forces: [
      { id: 'W', body: 'block', type: 'weight', angle: -90, label: 'W: Earth pulls block' },
      { id: 'N_on_block', body: 'block', type: 'normal', angle: 90, label: 'N: table pushes block' },
      { id: 'N_on_table', body: 'table', type: 'applied', angle: -90, label: "N′: block pushes table" },
    ],
    partners: { N_on_block: 'N_on_table', N_on_table: 'N_on_block' },
    extraBodies: { table: { label: 'Table surface', kind: 'ground-body', x: 0.5, y: 0.72, w: 0.5, h: 0.05 } },
    note: "The block's weight and the table's normal force are NOT a third-law pair — both act on the block. The real pair is: table-pushes-block ⇄ block-pushes-table.",
  },
  incline: {
    forces: [
      { id: 'W', body: 'block', type: 'weight', angle: -90, label: 'W: Earth pulls block' },
      { id: 'N_on_block', body: 'block', type: 'normal', angle: 90 + PAIR_INCLINE_ANGLE, label: 'N: ramp pushes block' },
      { id: 'N_on_ramp', body: 'ramp', type: 'applied', angle: -90 + PAIR_INCLINE_ANGLE, label: 'N′: block pushes ramp' },
    ],
    partners: { N_on_block: 'N_on_ramp', N_on_ramp: 'N_on_block' },
    extraBodies: { ramp: { label: 'Ramp', kind: 'ramp-body', x: 0.5, y: 0.72, w: 0.5, h: 0.05 } },
    note: 'The ramp pushes perpendicular to its own face; the block pushes back on the ramp with an equal, opposite force — on a different body.',
  },
  tug: {
    forces: [
      { id: 'T_on_block', body: 'block', type: 'tension', angle: 0, label: 'T: rope pulls block' },
      { id: 'T_on_rope', body: 'rope', type: 'tension', angle: 180, label: 'T′: block pulls rope' },
    ],
    partners: { T_on_block: 'T_on_rope', T_on_rope: 'T_on_block' },
    extraBodies: { rope: { label: 'Rope end', kind: 'rope-body', x: 0.78, y: 0.55, w: 0.14, h: 0.05 } },
    note: 'The rope pulls the crate; by the third law the crate pulls the rope with an equal, opposite force. Same rope, two different bodies.',
  },
  stacked: {
    // THE discriminator: A pushes DOWN on B, B pushes UP on A. Plus each block's
    // weight (Earth pair off-screen).
    forces: [
      { id: 'WA', body: 'blockA', type: 'weight', angle: -90, label: 'Wₐ: Earth pulls A' },
      { id: 'NB_on_A', body: 'blockA', type: 'normal', angle: 90, label: 'N: B pushes A up' },
      { id: 'NA_on_B', body: 'blockB', type: 'applied', angle: -90, label: "N′: A pushes B down" },
      { id: 'WB', body: 'blockB', type: 'weight', angle: -90, label: 'W_b: Earth pulls B' },
    ],
    partners: { NB_on_A: 'NA_on_B', NA_on_B: 'NB_on_A' },
    note: "Watch the contact pair: B-pushes-A-up ⇄ A-pushes-B-down. They act on DIFFERENT blocks. A's weight and B's push on A both act on A — those are not a pair.",
  },
  horsecart: {
    // The paradox pair: horse pulls cart forward ⇄ cart pulls horse backward.
    forces: [
      { id: 'T_on_cart', body: 'cart', type: 'tension', angle: 0, label: 'T: horse pulls cart →' },
      { id: 'T_on_horse', body: 'horse', type: 'tension', angle: 180, label: 'T′: cart pulls horse ←' },
      { id: 'f_ground', body: 'horse', type: 'friction', angle: 0, label: 'f: ground pushes horse →' },
    ],
    partners: { T_on_cart: 'T_on_horse', T_on_horse: 'T_on_cart' },
    note: 'THE PARADOX: the cart pulls back on the horse exactly as hard as the horse pulls the cart — but those two forces act on DIFFERENT bodies, so they never cancel. The horse still accelerates the system because the GROUND pushes it forward (a separate pair).',
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* shared canvas geometry helpers                                              */
/* ────────────────────────────────────────────────────────────────────────── */

// Body center + half-extents in canvas px for a given W,H.
function bodyRect(b, W, H) {
  return { cx: b.x * W, cy: b.y * H, hw: (b.w * W) / 2, hh: (b.h * H) / 2 };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw the static scenery (ground / incline / bodies) for a scene. `theta`
// overrides the incline surface angle (fbd mode drives it live from a slider).
// `offset` shifts the target body's drawn position (equilibrium-meter drift).
function drawScenery(ctx, scene, bodies, W, H, opts = {}) {
  const { dimBodies = [], highlightBody = null, theta = scene.surfaceAngle, offset = null, offsetBody = null } = opts;
  ctx.save();

  // ground line for level scenes
  if (theta === 0) {
    let gy = H * 0.66;
    // put ground just under the lowest body
    for (const b of Object.values(bodies)) {
      const r = bodyRect(b, W, H);
      if (b.kind !== 'ground-body' && b.kind !== 'rope-body') gy = Math.max(gy, r.cy + r.hh);
    }
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
    ctx.stroke();
    // hatching
    ctx.strokeStyle = 'rgba(139,140,142,0.35)';
    ctx.lineWidth = 1;
    for (let x = 8; x < W; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x - 8, gy + 8);
      ctx.stroke();
    }
  } else {
    // incline: a wedge rising to the right
    const ang = (theta * Math.PI) / 180;
    const baseY = H * 0.78;
    const runW = W * 0.86;
    const x0 = W * 0.07;
    const rise = runW * Math.tan(ang);
    ctx.fillStyle = 'rgba(26,35,50,0.9)';
    ctx.beginPath();
    ctx.moveTo(x0, baseY);
    ctx.lineTo(x0 + runW, baseY);
    ctx.lineTo(x0 + runW, baseY - rise);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 2;
    ctx.stroke();
    // angle label + arc
    ctx.fillStyle = MUTED;
    ctx.font = '12px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(theta)}°`, x0 + 22, baseY - 6);
    ctx.strokeStyle = 'rgba(139,140,142,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x0, baseY, 26, -ang, 0);
    ctx.stroke();
  }

  // bodies
  for (const [key, b] of Object.entries(bodies)) {
    const base = bodyRect(b, W, H);
    // apply the small drift offset only to the named body (the free body)
    const drift = offset && offsetBody === key ? offset : { x: 0, y: 0 };
    const r = { ...base, cx: base.cx + drift.x, cy: base.cy + drift.y };
    const dim = dimBodies.includes(key);
    ctx.globalAlpha = dim ? 0.35 : 1;

    const fill =
      key === highlightBody ? 'rgba(197,183,131,0.18)' : 'rgba(62,92,138,0.55)';
    const stroke = key === highlightBody ? GOLD : '#3E5C8A';

    if (b.kind === 'incline-block') {
      // rotate the block to sit on the ramp face (uses the live theta)
      const ang = (theta * Math.PI) / 180;
      ctx.save();
      ctx.translate(r.cx, r.cy);
      ctx.rotate(-ang);
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      roundRect(ctx, -r.hw, -r.hh, r.hw * 2, r.hh * 2, 6);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (b.kind === 'horse') {
      // simple stylized horse (body + head + legs)
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      roundRect(ctx, r.cx - r.hw, r.cy - r.hh * 0.5, r.hw * 1.6, r.hh, 8);
      ctx.fill();
      ctx.stroke();
      // head
      roundRect(ctx, r.cx - r.hw - 4, r.cy - r.hh * 1.2, r.hw * 0.5, r.hh * 0.9, 5);
      ctx.fill();
      ctx.stroke();
      // legs
      ctx.beginPath();
      for (const lx of [-0.6, -0.1, 0.4, 0.9]) {
        const px = r.cx + lx * r.hw;
        ctx.moveTo(px, r.cy + r.hh * 0.5);
        ctx.lineTo(px, r.cy + r.hh * 1.2);
      }
      ctx.stroke();
    } else if (b.kind === 'cart') {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      roundRect(ctx, r.cx - r.hw, r.cy - r.hh, r.hw * 2, r.hh, 6);
      ctx.fill();
      ctx.stroke();
      // wheels
      ctx.fillStyle = DEEP;
      for (const wx of [-0.55, 0.55]) {
        ctx.beginPath();
        ctx.arc(r.cx + wx * r.hw, r.cy + r.hh * 0.2, r.hh * 0.4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    } else if (b.kind === 'ground-body' || b.kind === 'ramp-body' || b.kind === 'rope-body') {
      // slim contextual body used only in pairs mode (the "other body")
      ctx.fillStyle = dim ? 'rgba(62,92,138,0.25)' : 'rgba(62,92,138,0.5)';
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      roundRect(ctx, r.cx - r.hw, r.cy - r.hh, r.hw * 2, r.hh * 2, 4);
      ctx.fill();
      ctx.stroke();
    } else {
      // plain block
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      roundRect(ctx, r.cx - r.hw, r.cy - r.hh, r.hw * 2, r.hh * 2, 6);
      ctx.fill();
      ctx.stroke();
    }

    // label
    ctx.globalAlpha = dim ? 0.4 : 0.85;
    ctx.fillStyle = TEXT;
    ctx.font = '12px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(b.label, r.cx, r.cy - r.hh - 10);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ────────────────────────────────────────────────────────────────────────── */
/* thin wrapper — branch by mode (hook-free)                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export default function FbdBuilder({ mode = 'fbd' }) {
  if (mode === 'pairs') return <PairsMode />;
  return <FbdMode />;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* FBD MODE — drag from palette, aim, check                                    */
/* ────────────────────────────────────────────────────────────────────────── */

const FBD_SCENES = ['table', 'incline', 'tug', 'stacked'];

// Balance threshold in palette px. |ΣF| below this counts as equilibrium.
const BALANCE_EPS = 10;

function FbdMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [sceneKey, setSceneKey] = useState('table');
  const [forces, setForces] = useState([]);          // [{uid, type, angle, mag}]
  const [selected, setSelected] = useState(null);    // uid of selected force
  const [feedback, setFeedback] = useState(null);    // check result
  const [inclineDeg, setInclineDeg] = useState(SCENES.incline.surfaceAngle);
  const [polygon, setPolygon] = useState(false);     // tip-to-tail toggle
  const [showTarget, setShowTarget] = useState(false); // "Show me" ghost
  const [, forceRerender] = useState(0);

  const scene = SCENES[sceneKey];
  // Live surface angle: only the incline scene is adjustable.
  const theta = scene.inclineAdjustable ? inclineDeg : scene.surfaceAngle;
  const target = scene.bodies[scene.target];

  // The scene's expected forces for the current angle (drives Show-me + checker).
  const expected = useMemo(() => expectedForces(scene, theta), [scene, theta]);

  // Mutable refs mirror state so the pointer/draw handlers (bound once) see fresh data.
  const forcesRef = useRef(forces);
  forcesRef.current = forces;
  const selRef = useRef(selected);
  selRef.current = selected;
  const polygonRef = useRef(polygon);
  polygonRef.current = polygon;
  const showTargetRef = useRef(showTarget);
  showTargetRef.current = showTarget;
  const expectedRef = useRef(expected);
  expectedRef.current = expected;
  const thetaRef = useRef(theta);
  thetaRef.current = theta;
  const dragRef = useRef(null);        // { kind:'tip', uid }
  const geomRef = useRef({ W: 0, H: 0 });
  const driftRef = useRef({ x: 0, y: 0 }); // animated body-drift offset

  const resetScene = useCallback(() => {
    setForces([]);
    setSelected(null);
    setFeedback(null);
    setPolygon(false);
    setShowTarget(false);
    driftRef.current = { x: 0, y: 0 };
  }, []);

  // Switching scenes clears the diagram.
  useEffect(() => { resetScene(); }, [sceneKey, resetScene]);
  // Re-aiming the ramp invalidates a prior check (angles/mags changed).
  useEffect(() => { setFeedback(null); setShowTarget(false); }, [theta]);

  // Look up the expected magnitude for a freshly-dropped force so a correctly
  // aimed diagram closes. Matches by type + nearest expected angle; falls back
  // to the palette default when the scene doesn't expect that type.
  const expectedMagFor = useCallback((type, angle) => {
    const cands = expected.filter((e) => e.type === type);
    if (cands.length === 0) return FORCE_TYPES[type].mag;
    let best = cands[0], bestErr = Infinity;
    for (const c of cands) {
      const err = angleDiff(angle ?? FORCE_TYPES[type].angle, c.angle);
      if (err < bestErr) { bestErr = err; best = c; }
    }
    return best.mag;
  }, [expected]);

  const addForce = (type, angle) => {
    const uid = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const a = angle ?? FORCE_TYPES[type].angle;
    const mag = expectedMagFor(type, a);
    setForces((f) => [...f, { uid, type, angle: a, mag }]);
    setSelected(uid);
    setFeedback(null);
    return uid;
  };

  const removeForce = (uid) => {
    setForces((f) => f.filter((x) => x.uid !== uid));
    setSelected((s) => (s === uid ? null : s));
    setFeedback(null);
  };

  /* ── canvas draw loop ─────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, raf;
    let last = performance.now();

    const resize = () => {
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      ctx = setupCanvasLocal(canvas, W, H);
      geomRef.current = { W, H };
    };

    const draw = (now) => {
      const { W, H } = geomRef.current;
      if (!ctx || !W) { raf = requestAnimationFrame(draw); return; }
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const list = forcesRef.current;
      const th = thetaRef.current;

      // net force in canvas px (drives drift + the ΣF arrow)
      const vecs = list.map((f) => polar(f.angle, f.mag));
      const net = vecs.length ? resultant(vecs) : { dx: 0, dy: 0 };
      const netMag = Math.hypot(net.dx, net.dy);
      const balanced = list.length > 0 && netMag <= BALANCE_EPS;

      // ── equilibrium meter: drift the body along ΣF when unbalanced ──
      const drift = driftRef.current;
      if (!balanced && netMag > BALANCE_EPS) {
        // spring the drift toward a bounded offset in the ΣF direction
        const cap = 26;
        const ux = net.dx / netMag, uy = net.dy / netMag;
        const tx = ux * cap, ty = uy * cap;
        drift.x += (tx - drift.x) * Math.min(1, dt * 3);
        drift.y += (ty - drift.y) * Math.min(1, dt * 3);
        // gentle bob so motion reads as "trying to accelerate"
      } else {
        // ease back to rest when balanced / empty
        drift.x += (0 - drift.x) * Math.min(1, dt * 6);
        drift.y += (0 - drift.y) * Math.min(1, dt * 6);
      }

      ctx.clearRect(0, 0, W, H);
      drawScenery(ctx, scene, scene.bodies, W, H, {
        highlightBody: scene.target,
        theta: th,
        offset: drift,
        offsetBody: scene.target,
      });

      const rBase = bodyRect(target, W, H);
      const r = { cx: rBase.cx + drift.x, cy: rBase.cy + drift.y };

      // ── "Show me" ghost of the expected forces, at their target angles ──
      if (showTargetRef.current) {
        ctx.save();
        ctx.setLineDash([2, 4]);
        for (const e of expectedRef.current) {
          const { dx, dy } = polar(e.angle, e.mag);
          drawArrow(ctx, {
            x: r.cx, y: r.cy, dx, dy,
            color: 'rgba(127,183,126,0.55)', width: 2.5,
            label: `${FORCE_TYPES[e.type].sym}✓`, head: 10,
          });
        }
        ctx.restore();
      }

      if (polygonRef.current) {
        drawForcePolygon(ctx, list, W, H, net);
      } else {
        // draw each placed force from the body center
        for (const f of list) {
          const t = FORCE_TYPES[f.type];
          const { dx, dy } = polar(f.angle, f.mag);
          const isSel = selRef.current === f.uid;
          drawArrow(ctx, {
            x: r.cx, y: r.cy, dx, dy,
            color: t.color, width: isSel ? 5 : 3.5,
            label: `${t.sym}`, head: 12,
          });
          // tip handle
          ctx.save();
          ctx.fillStyle = isSel ? TEXT : t.color;
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(r.cx + dx, r.cy + dy, isSel ? 7 : 5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        // net-force resultant (bold when nonzero, from the body center)
        if (list.length > 0 && netMag > 2) {
          ctx.save();
          ctx.setLineDash([6, 5]);
          drawArrow(ctx, {
            x: r.cx, y: r.cy, dx: net.dx, dy: net.dy,
            color: balanced ? 'rgba(240,236,227,0.4)' : '#E86A5C',
            width: balanced ? 2.5 : 4.5, label: 'ΣF', head: balanced ? 11 : 14,
          });
          ctx.restore();
        }

        // center dot
        ctx.fillStyle = TEXT;
        ctx.beginPath();
        ctx.arc(r.cx, r.cy, 3.5, 0, 2 * Math.PI);
        ctx.fill();

        // ── balanced badge snapped on the body ──
        if (balanced) {
          drawBalancedBadge(ctx, r.cx, r.cy - bodyRect(target, W, H).hh - 30);
        }
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [scene, target]);

  /* ── pointer interaction on the canvas (select + aim tip) ─────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const localPt = (ev) => {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };

    const onDown = (ev) => {
      if (polygonRef.current) return; // no tip-dragging in polygon view
      const { W, H } = geomRef.current;
      const rBase = bodyRect(target, W, H);
      const d = driftRef.current;
      const r = { cx: rBase.cx + d.x, cy: rBase.cy + d.y };
      const p = localPt(ev);
      // hit-test tips first (topmost wins → iterate reversed)
      const list = forcesRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i];
        const { dx, dy } = polar(f.angle, f.mag);
        const tx = r.cx + dx, ty = r.cy + dy;
        if (Math.hypot(p.x - tx, p.y - ty) < 16) {
          setSelected(f.uid);
          dragRef.current = { kind: 'tip', uid: f.uid };
          canvas.setPointerCapture?.(ev.pointerId);
          ev.preventDefault();
          return;
        }
      }
      // otherwise deselect
      setSelected(null);
    };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const { W, H } = geomRef.current;
      const rBase = bodyRect(target, W, H);
      const off = driftRef.current;
      const r = { cx: rBase.cx + off.x, cy: rBase.cy + off.y };
      const p = localPt(ev);
      const dx = p.x - r.cx, dy = p.y - r.cy;
      const ang = angleOf(dx, dy);
      const mag = Math.max(24, Math.min(160, Math.hypot(dx, dy)));
      setForces((f) => f.map((x) => (x.uid === d.uid ? { ...x, angle: ang, mag } : x)));
      setFeedback(null);
      ev.preventDefault();
    };

    const onUp = (ev) => {
      if (dragRef.current) {
        canvas.releasePointerCapture?.(ev.pointerId);
        dragRef.current = null;
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [target]);

  /* ── palette drop: tap-to-add + pointer-drag-to-aim ───────────────────── */
  const paletteDrag = useRef(null); // { type }
  const onPaletteDown = (type) => (ev) => {
    paletteDrag.current = { type, moved: false };
    const move = (e) => {
      paletteDrag.current.moved = true;
      forceRerender((n) => n + 1); // reposition ghost
      paletteDrag.current.pt = { x: e.clientX, y: e.clientY };
    };
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const pd = paletteDrag.current;
      paletteDrag.current = null;
      const canvas = canvasRef.current;
      if (pd && pd.moved && canvas) {
        const rect = canvas.getBoundingClientRect();
        const inside =
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (inside) {
          // aim the new force toward the drop point from the body center
          const { W, H } = geomRef.current;
          const off = driftRef.current;
          const rBase = bodyRect(target, W, H);
          const dx = e.clientX - rect.left - (rBase.cx + off.x);
          const dy = e.clientY - rect.top - (rBase.cy + off.y);
          const ang = Math.hypot(dx, dy) > 12 ? angleOf(dx, dy) : FORCE_TYPES[type].angle;
          addForce(type, ang);
        }
      } else if (pd) {
        addForce(type); // tap → add at default direction
      }
      forceRerender((n) => n + 1);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    ev.preventDefault();
  };

  /* ── live net force (relative palette units, +y up) ───────────────────── */
  const net = useMemo(() => {
    let fx = 0, fy = 0;
    for (const f of forces) {
      const r = (f.angle * Math.PI) / 180;
      fx += Math.cos(r) * f.mag;
      fy += Math.sin(r) * f.mag;
    }
    const mag = Math.hypot(fx, fy);
    const dir = mag > 0.5 ? (Math.atan2(fy, fx) * 180) / Math.PI : 0;
    return { fx, fy, mag, dir };
  }, [forces]);

  const balanced = forces.length > 0 && net.mag <= BALANCE_EPS;

  /* ── Check: specific physics feedback (angle-aware via live theta) ─────── */
  const runCheck = () => {
    setFeedback(checkDiagram(scene, forces, expected, theta));
    setShowTarget(false);
  };

  const selForce = forces.find((f) => f.uid === selected);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={resetScene}>
        <SceneButtons keys={FBD_SCENES} sceneKey={sceneKey} setSceneKey={setSceneKey} />

        {scene.inclineAdjustable && (
          <div className="mt-3 border-t border-usna-grid pt-3">
            <SliderLocal
              label="Incline angle" value={inclineDeg}
              min={5} max={55} step={1} unit="°"
              onChange={(v) => setInclineDeg(v)}
            />
            <div className="text-usna-muted text-[11px] leading-snug -mt-1">
              N = W·cos θ, f = W·sin θ. Steeper ramp → smaller N, larger friction.
            </div>
          </div>
        )}

        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-2">Force palette</div>
          <div className="text-usna-muted text-xs mb-2">Tap to add, or drag onto the body to aim.</div>
          <div className="flex flex-col gap-1.5">
            {TYPE_ORDER.map((type) => {
              const t = FORCE_TYPES[type];
              return (
                <button
                  key={type}
                  onPointerDown={onPaletteDown(type)}
                  className="flex items-center gap-2 px-3 py-2 rounded text-sm text-left border border-usna-grid bg-usna-deep hover:border-usna-gold transition-colors touch-none select-none"
                  style={{ touchAction: 'none' }}
                >
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: t.color }} />
                  <span className="text-usna-text">{t.label}</span>
                  <span className="ml-auto font-mono text-usna-muted text-xs">{t.sym}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selForce && (
          <div className="mt-3 border-t border-usna-grid pt-3">
            <div className="text-usna-text text-sm font-medium mb-1">
              Selected: {FORCE_TYPES[selForce.type].label}
            </div>
            <div className="text-usna-muted text-xs mb-2">{FORCE_TYPES[selForce.type].hint}</div>
            <SliderLocal
              label="Direction" value={Math.round(((selForce.angle % 360) + 360) % 360)}
              min={0} max={359} step={1} unit="°"
              onChange={(v) => { setForces((f) => f.map((x) => (x.uid === selForce.uid ? { ...x, angle: v } : x))); setFeedback(null); }}
            />
            <SliderLocal
              label="Magnitude" value={Math.round(selForce.mag)}
              min={24} max={160} step={1} unit="px"
              onChange={(v) => { setForces((f) => f.map((x) => (x.uid === selForce.uid ? { ...x, mag: v } : x))); setFeedback(null); }}
            />
            <button
              onClick={() => removeForce(selForce.uid)}
              className="mt-1 w-full py-1.5 rounded text-xs font-medium bg-usna-deep text-usna-muted hover:text-red-300 border border-usna-grid transition-colors"
            >
              Remove this force
            </button>
          </div>
        )}

        <div className="mt-3 border-t border-usna-grid pt-3 flex flex-col gap-2">
          <button
            onClick={runCheck}
            className="w-full py-2 rounded text-sm font-semibold bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            Check diagram
          </button>
          {feedback && (
            <button
              onClick={() => setShowTarget((s) => !s)}
              className={`w-full py-2 rounded text-sm font-medium border transition-colors ${
                showTarget
                  ? 'bg-green-900/30 text-green-200 border-green-600'
                  : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold'
              }`}
            >
              {showTarget ? 'Hide the target diagram' : 'Show me the correct forces'}
            </button>
          )}
          <button
            onClick={() => setPolygon((p) => !p)}
            className={`w-full py-2 rounded text-sm font-medium border transition-colors ${
              polygon
                ? 'bg-usna-gold/20 text-usna-gold border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold'
            }`}
          >
            {polygon ? 'Back to the free body' : 'Tip-to-tail (force polygon)'}
          </button>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className={`flex items-center justify-between rounded px-2 py-1.5 mb-2 text-sm font-semibold ${
            balanced ? 'bg-green-900/30 text-green-200 border border-green-700'
                     : forces.length ? 'bg-red-900/25 text-red-200 border border-red-800/70'
                     : 'bg-usna-deep text-usna-muted border border-usna-grid'
          }`}>
            {balanced ? '⚖ Balanced — a = 0'
              : forces.length ? '⚠ Net force → accelerating'
              : 'No forces yet'}
          </div>
          <Readout label="ΣFx" value={fmt(net.fx)} unit="rel" />
          <Readout label="ΣFy" value={fmt(net.fy)} unit="rel" />
          <Readout label="|ΣF|" value={fmt(net.mag)} unit="rel" />
          <Readout label="direction" value={net.mag > 0.5 ? `${net.dir.toFixed(0)}` : '—'} unit="°" />
          <div className="text-usna-muted text-[11px] mt-1 leading-snug">
            Magnitudes are relative palette units. A correct static diagram closes
            to |ΣF| ≈ 0.
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
          style={{ height: 440, touchAction: 'none' }}
        >
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 left-3 text-xs font-mono text-usna-muted pointer-events-none">
            {polygon ? 'tip-to-tail: closed polygon ⇒ ΣF = 0' : "drag a force's tip to aim & stretch it"}
          </div>
          {forces.length === 0 && !polygon && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-usna-muted text-sm bg-usna-deep/70 px-4 py-2 rounded">
                Add forces from the palette to build the diagram
              </div>
            </div>
          )}
          {/* palette drag ghost */}
          {paletteDrag.current && paletteDrag.current.moved && paletteDrag.current.pt && (
            <PaletteGhost pt={paletteDrag.current.pt} type={paletteDrag.current.type} />
          )}
        </div>

        {feedback && <FeedbackPanel feedback={feedback} />}

        <InfoPanel {...FBD_INFO} />
      </div>
    </div>
  );
}

// Draw the placed forces head-to-tail from a fixed origin; the gap from the last
// tip back to the origin IS the net force (zero ⇒ closed polygon ⇒ equilibrium).
function drawForcePolygon(ctx, list, W, H, net) {
  const ox = W * 0.32, oy = H * 0.5; // polygon origin (left-of-center for room)
  ctx.save();
  ctx.fillStyle = MUTED;
  ctx.font = '12px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('Force polygon (each vector starts where the last ended)', 12, 22);

  let x = ox, y = oy;
  // origin marker
  ctx.fillStyle = TEXT;
  ctx.beginPath();
  ctx.arc(ox, oy, 3.5, 0, 2 * Math.PI);
  ctx.fill();

  for (const f of list) {
    const t = FORCE_TYPES[f.type];
    const { dx, dy } = polar(f.angle, f.mag);
    drawArrow(ctx, { x, y, dx, dy, color: t.color, width: 3.5, label: t.sym, head: 11 });
    x += dx; y += dy;
  }

  const netMag = Math.hypot(net.dx, net.dy);
  if (list.length > 0) {
    if (netMag <= BALANCE_EPS) {
      // closed — highlight the closure back to origin
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ox, oy);
      ctx.stroke();
      ctx.setLineDash([]);
      drawBalancedBadge(ctx, ox, oy - 40, 'closed — ΣF = 0');
    } else {
      // the gap = net force
      ctx.setLineDash([6, 5]);
      drawArrow(ctx, {
        x, y, dx: ox - x, dy: oy - y,
        color: '#E86A5C', width: 4, label: 'gap = −ΣF', head: 13,
      });
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

// Snap a green equilibrium badge near (x,y).
function drawBalancedBadge(ctx, x, y, text = '⚖ balanced — a = 0') {
  ctx.save();
  ctx.font = 'bold 13px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 20;
  const h = 24;
  ctx.fillStyle = 'rgba(20,48,24,0.92)';
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = GREEN;
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

// Floating ghost chip fixed to the pointer while dragging from the palette.
function PaletteGhost({ pt, type }) {
  const t = FORCE_TYPES[type];
  return (
    <div
      className="fixed z-50 pointer-events-none px-2 py-1 rounded text-xs font-mono shadow-lg"
      style={{
        left: pt.x + 8, top: pt.y + 8, background: DEEP, color: t.color,
        border: `1px solid ${t.color}`,
      }}
    >
      {t.sym} · {t.label}
    </div>
  );
}

function FeedbackPanel({ feedback }) {
  const { ok, items } = feedback;
  return (
    <div className={`rounded-lg border p-4 ${ok ? 'border-green-600/60 bg-green-900/15' : 'border-amber-600/60 bg-amber-900/12'}`}>
      <div className={`font-semibold mb-2 ${ok ? 'text-green-300' : 'text-amber-300'}`}>
        {ok ? '✓ Correct free-body diagram — and it closes (ΣF ≈ 0)' : 'Not quite — here is what to fix'}
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={
              it.kind === 'good' ? 'text-green-400' :
              it.kind === 'missing' ? 'text-red-400' :
              it.kind === 'extra' ? 'text-purple-400' :
              it.kind === 'mag' ? 'text-sky-400' : 'text-amber-400'
            }>
              {it.kind === 'good' ? '✓' : it.kind === 'missing' ? '＋' : it.kind === 'extra' ? '✗' : it.kind === 'mag' ? '↔' : '↻'}
            </span>
            <span className="text-usna-text">{it.msg}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── the checker: turns the placed forces into specific feedback ──────────── */
// `expected` is already resolved for the current incline angle.
function checkDiagram(scene, forces, expected, theta) {
  const items = [];
  const need = expected.map((c, i) => ({ ...c, i, matched: false }));
  const used = new Array(forces.length).fill(false);
  // magnitude tolerance scales with the reference weight (±28% of W)
  const magTol = W_SCALE * 0.28;

  // Pass 1: match each placed force to a needed force of the same type whose
  // angle is close. Prefer the closest unmatched need.
  forces.forEach((f, fi) => {
    let best = -1, bestErr = Infinity;
    need.forEach((n) => {
      if (n.matched || n.type !== f.type) return;
      const err = angleDiff(f.angle, n.angle);
      if (err < bestErr) { bestErr = err; best = n.i; }
    });
    if (best >= 0 && bestErr <= 22) {
      need[best].matched = true;
      used[fi] = true;
      const magErr = Math.abs(f.mag - need[best].mag);
      if (magErr <= magTol) {
        items.push({ kind: 'good', msg: `${FORCE_TYPES[f.type].label} — correct: ${need[best].why}` });
      } else {
        // right type & direction, but the magnitude won't let the diagram close
        const bigger = f.mag > need[best].mag;
        items.push({
          kind: 'mag',
          msg: `${FORCE_TYPES[f.type].label} points the right way, but it's too ${bigger ? 'long' : 'short'} to balance. ${need[best].why} Drag its tip so its length matches the others that must cancel it.`,
        });
      }
    }
  });

  // Pass 2: right type but wrong direction (a misdirected force).
  forces.forEach((f, fi) => {
    if (used[fi]) return;
    const cand = need.find((n) => !n.matched && n.type === f.type);
    if (cand) {
      cand.matched = true;
      used[fi] = true;
      items.push({ kind: 'wrong', msg: misdirectMsg(scene, f, cand, theta) });
    }
  });

  // Pass 3: leftover placed forces of a type not expected at all → extra.
  forces.forEach((f, fi) => {
    if (used[fi]) return;
    items.push({ kind: 'extra', msg: extraMsg(scene, f, expected) });
  });

  // Pass 4: any needed force still unmatched → missing.
  need.forEach((n) => {
    if (!n.matched) {
      items.push({ kind: 'missing', msg: `Missing ${FORCE_TYPES[n.type].label} force. ${n.why}` });
    }
  });

  const ok = items.length > 0 && items.every((it) => it.kind === 'good');
  if (ok) items.unshift({ kind: 'good', msg: 'Every force is present, pointing the right way, and correctly sized — so ΣF ≈ 0 and the body stays at rest.' });
  return { ok, items };
}

function misdirectMsg(scene, f, cand, theta) {
  const label = FORCE_TYPES[f.type].label;
  if (f.type === 'normal') {
    if (theta > 0) {
      return `Your normal force is off. The surface is inclined at ${Math.round(theta)}°, so N is perpendicular to the RAMP face (aim it ${Math.round(90 + theta)}° from +x, not straight up).`;
    }
    return `Your normal force should point straight up (away from the level surface).`;
  }
  if (f.type === 'weight') {
    return `Weight always points straight DOWN toward Earth's center — yours is aimed the wrong way.`;
  }
  if (f.type === 'friction') {
    if (theta > 0) return `Friction acts ALONG the incline surface (up the slope here, ${Math.round(theta)}° from +x), not across it.`;
    return `Friction acts along the surface, opposing the slip — check its direction.`;
  }
  if (f.type === 'tension') {
    return `Tension pulls along the rope, AWAY from the body. Aim it along the rope.`;
  }
  return `Your ${label} force has the right idea but the wrong direction. ${cand.why}`;
}

function extraMsg(scene, f, expected) {
  const label = FORCE_TYPES[f.type].label;
  const needsFriction = expected.some((c) => c.type === 'friction');
  if (f.type === 'friction' && !needsFriction) {
    return `Extra friction force. Nothing is trying to slide here, so there is no friction to draw.`;
  }
  if (f.type === 'applied') {
    return `Extra applied force. Nobody is pushing or pulling this body directly in this scene.`;
  }
  if (f.type === 'tension') {
    return `Extra tension force — there is no rope providing this pull on the body.`;
  }
  if (f.type === 'normal') {
    return `Extra normal force. A body has one normal force per surface it touches.`;
  }
  return `Extra ${label} force — this one does not act on the body in this scene.`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* PAIRS MODE — click a force, its 3rd-law partner lights up on the other body */
/* ────────────────────────────────────────────────────────────────────────── */

const PAIRS_SCENES = ['table', 'stacked', 'incline', 'tug', 'horsecart'];

function PairsMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [sceneKey, setSceneKey] = useState('table');
  const [selected, setSelected] = useState(null); // force id
  const geomRef = useRef({ W: 0, H: 0 });

  const scene = SCENES[sceneKey];
  const pair = PAIR_SCENES[sceneKey];
  // pairs mode illustrates the incline at its fixed reference angle
  const theta = scene.inclineAdjustable ? PAIR_INCLINE_ANGLE : scene.surfaceAngle;

  // Assemble the full body map: scene bodies + any pairs-only "other" bodies.
  const bodies = useMemo(
    () => ({ ...scene.bodies, ...(pair.extraBodies || {}) }),
    [scene, pair]
  );

  const selRef = useRef(selected);
  selRef.current = selected;
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  useEffect(() => { setSelected(null); }, [sceneKey]);

  // Where does each force attach? For most forces it emanates from the body
  // center; render offsets keep multiple forces on one body legible.
  const forceOrigin = useCallback((f, W, H) => {
    const b = bodies[f.body];
    const r = bodyRect(b, W, H);
    return { x: r.cx, y: r.cy };
  }, [bodies]);

  /* draw loop */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, raf;

    const resize = () => {
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      ctx = setupCanvasLocal(canvas, W, H);
      geomRef.current = { W, H };
    };

    const draw = () => {
      const { W, H } = geomRef.current;
      if (!ctx || !W) { raf = requestAnimationFrame(draw); return; }
      const sel = selRef.current;
      const partner = sel ? pair.partners[sel] : null;

      ctx.clearRect(0, 0, W, H);

      // dim non-involved bodies when a pair is highlighted
      let dimBodies = [];
      if (sel) {
        const active = new Set();
        const sf = pair.forces.find((x) => x.id === sel);
        if (sf) active.add(sf.body);
        if (partner) {
          const pf = pair.forces.find((x) => x.id === partner);
          if (pf) active.add(pf.body);
        }
        dimBodies = Object.keys(bodiesRef.current).filter((k) => !active.has(k));
      }
      drawScenery(ctx, scene, bodiesRef.current, W, H, { dimBodies, theta });

      // draw every pre-placed force
      for (const f of pair.forces) {
        const t = FORCE_TYPES[f.type];
        const o = forceOrigin(f, W, H);
        const { dx, dy } = polar(f.angle, 92);
        const isSel = f.id === sel;
        const isPartner = f.id === partner;
        let color = t.color;
        let alpha = 1;
        if (sel) {
          if (isSel) color = GOLD;
          else if (isPartner) color = GREEN;
          else alpha = 0.25;
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        if (isSel || isPartner) {
          // glow
          ctx.shadowColor = color;
          ctx.shadowBlur = 14;
        }
        drawArrow(ctx, {
          x: o.x, y: o.y, dx, dy, color,
          width: isSel || isPartner ? 5.5 : 3.5,
          label: f.label, head: 13,
        });
        ctx.restore();
        // clickable tip dot
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = isSel || isPartner ? TEXT : color;
        ctx.beginPath();
        ctx.arc(o.x + dx, o.y + dy, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
      }

      // connecting brace between a selected pair (visual "these two go together")
      if (sel && partner) {
        const sf = pair.forces.find((x) => x.id === sel);
        const pf = pair.forces.find((x) => x.id === partner);
        if (sf && pf) {
          const a = forceOrigin(sf, W, H);
          const b = forceOrigin(pf, W, H);
          ctx.save();
          ctx.setLineDash([4, 6]);
          ctx.strokeStyle = 'rgba(197,183,131,0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [scene, pair, forceOrigin, theta]);

  /* pointer: click a force (its shaft or tip) to select */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      const { W, H } = geomRef.current;
      // topmost first
      for (let i = pair.forces.length - 1; i >= 0; i--) {
        const f = pair.forces[i];
        const b = bodies[f.body];
        const r = bodyRect(b, W, H);
        const { dx, dy } = polar(f.angle, 92);
        // distance from point to the arrow segment
        if (distToSegment(px, py, r.cx, r.cy, r.cx + dx, r.cy + dy) < 12) {
          setSelected((s) => (s === f.id ? null : f.id));
          ev.preventDefault();
          return;
        }
      }
      setSelected(null);
    };

    canvas.addEventListener('pointerdown', onDown);
    return () => canvas.removeEventListener('pointerdown', onDown);
  }, [pair, bodies]);

  const selForce = pair.forces.find((f) => f.id === selected);
  const partnerId = selected ? pair.partners[selected] : null;
  const partnerForce = partnerId ? pair.forces.find((f) => f.id === partnerId) : null;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={() => setSelected(null)}>
        <SceneButtons keys={PAIRS_SCENES} sceneKey={sceneKey} setSceneKey={setSceneKey} />

        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-2">Forces in the scene</div>
          <div className="text-usna-muted text-xs mb-2">
            Click a force to reveal its Newton's-third-law partner.
          </div>
          <div className="flex flex-col gap-1.5">
            {pair.forces.map((f) => {
              const active = selected === f.id;
              const isPartner = partnerId === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setSelected((s) => (s === f.id ? null : f.id))}
                  className={`px-2.5 py-1.5 rounded text-xs text-left border transition-colors ${
                    active ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : isPartner ? 'border-green-500 text-green-300 bg-green-900/20'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold'
                  }`}
                >
                  <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle"
                        style={{ background: FORCE_TYPES[f.type].color }} />
                  {f.label}
                  {pair.partners[f.id] ? '' : <span className="ml-1 opacity-60">(pair off-screen)</span>}
                </button>
              );
            })}
          </div>
        </div>

        {selForce && (
          <div className="mt-3 border-t border-usna-grid pt-3 text-sm">
            <div className="text-usna-gold font-medium mb-1">Selected</div>
            <div className="text-usna-text mb-2">{selForce.label}</div>
            {partnerForce ? (
              <>
                <div className="text-green-300 font-medium mb-1">Third-law partner</div>
                <div className="text-usna-text mb-2">{partnerForce.label}</div>
                <div className="text-usna-muted text-xs leading-snug">
                  Equal magnitude, opposite direction, and — crucially — acting on a
                  DIFFERENT body ({bodies[partnerForce.body].label}).
                </div>
              </>
            ) : (
              <div className="text-usna-muted text-xs leading-snug">
                This force's third-law partner acts on a body that is off-screen
                (e.g. the Earth, for weight). It's still equal and opposite.
              </div>
            )}
          </div>
        )}
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
          style={{ height: 440, touchAction: 'none' }}
        >
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 left-3 text-xs font-mono text-usna-muted pointer-events-none">
            click any arrow
          </div>
        </div>

        <div className="rounded-lg border border-usna-grid bg-usna-card p-4">
          <div className="text-usna-gold font-semibold mb-1">
            {sceneKey === 'horsecart' ? 'The horse-and-cart paradox' : scene.label}
          </div>
          <p className="text-usna-text text-sm leading-relaxed">{pair.note}</p>
        </div>

        <InfoPanel {...PAIRS_INFO} />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* small local UI + math helpers (no shared-lib edits)                         */
/* ────────────────────────────────────────────────────────────────────────── */

function SceneButtons({ keys, sceneKey, setSceneKey }) {
  return (
    <div>
      <div className="text-usna-text text-sm font-medium mb-2">Scene</div>
      <div className="flex flex-col gap-1.5">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => setSceneKey(k)}
            className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
              sceneKey === k
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {SCENES[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}

// A minimal slider that mirrors the shared Slider API but stays local so we can
// use it for the direction/magnitude dials and the incline angle without
// touching shared components.
function SliderLocal({ label, value, min, max, step, unit, onChange }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-usna-text text-sm">{label}</span>
        <span className="font-mono text-usna-gold text-sm tabular-nums">
          {value}<span className="text-usna-muted text-xs ml-0.5">{unit}</span>
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onInput={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label} className="w-full"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
}

// Local DPR-aware canvas setup (mirrors shared canvas.js; kept local so this
// file has zero coupling to any shared canvas internals beyond the arrow prim).
function setupCanvasLocal(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Distance from point (px,py) to segment (x1,y1)-(x2,y2).
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function fmt(n) {
  if (Math.abs(n) < 0.5) return '0';
  return n.toFixed(0);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* copy                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

const FBD_INFO = {
  title: 'Build the free-body diagram',
  description:
    'A free-body diagram shows every force acting ON the body — and nothing else. Add each force from the palette, drag its tip to aim AND size it, and watch ΣF update. The counterintuitive moment on the incline: weight is ALWAYS straight down, but the normal force tilts with the ramp and shrinks (N = W·cos θ) while friction along the slope grows (f = W·sin θ). Get all three right and the diagram CLOSES to ΣF ≈ 0 — the equilibrium meter turns green. Flip to the tip-to-tail polygon to see closure geometrically, drag the incline-angle slider to explore the whole family, and hit "Check" then "Show me" for force-by-force guidance.',
  equation: String.raw`\vec F_{net} = \sum \vec F_i = m\,\vec a, \qquad N = W\cos\theta,\; f = W\sin\theta`,
};

const PAIRS_INFO = {
  title: "Newton's third law: partners live on different bodies",
  description:
    'For every force there is an equal and opposite reaction — but the two act on DIFFERENT bodies, so they can never cancel on a single free-body diagram. Click a force to light up its partner across the gap. The horse-and-cart paradox is the payoff: the cart pulls back on the horse exactly as hard as the horse pulls the cart, yet the cart still accelerates, because the reaction acts on the horse, not the cart — and the ground pushes the horse forward.',
  equation: String.raw`\vec F_{A\to B} = -\,\vec F_{B\to A}`,
};
