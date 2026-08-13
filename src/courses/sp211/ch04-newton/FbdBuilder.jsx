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
  weight: { label: 'Weight', sym: 'W', color: '#5B9BD5', angle: -90, mag: W_SCALE, hint: 'Gravity, always straight down.' },
  normal: { label: 'Normal', sym: 'N', color: GREEN, angle: 90, mag: W_SCALE, hint: 'Surface push, perpendicular to the surface.' },
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
    task: 'Draw every force acting on the block resting on the level table.',
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
    task: 'Draw every force acting on the block held at rest on the ramp.',
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
    task: 'Draw every force acting on the crate while both teams pull.',
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
    task: 'Draw every force acting on the top block A (the forces on A, by other objects).',
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
    label: 'Horse and cart',
    surfaceAngle: 0,
    inclineAdjustable: false,
    target: 'cart',
    bodies: {
      horse: { label: 'Horse', kind: 'horse', x: 0.34, y: 0.52, w: 0.22, h: 0.22 },
      cart: { label: 'Cart', kind: 'cart', x: 0.66, y: 0.55, w: 0.22, h: 0.16 },
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
    // y chosen so the slab's TOP meets the block's base (block y 0.52 + h/2 0.08 = 0.60).
    extraBodies: { table: { label: 'Table surface', kind: 'ground-body', x: 0.5, y: 0.625, w: 0.5, h: 0.05 } },
    note: "The block's weight and the table's normal force are not a third-law pair, because both act on the block. The real pair is the table pushing up on the block and the block pushing down on the table.",
  },
  incline: {
    forces: [
      { id: 'W', body: 'block', type: 'weight', angle: -90, label: 'W: Earth pulls block' },
      { id: 'N_on_block', body: 'block', type: 'normal', angle: 90 + PAIR_INCLINE_ANGLE, label: 'N: ramp pushes block' },
      { id: 'N_on_ramp', body: 'ramp', type: 'applied', angle: -90 + PAIR_INCLINE_ANGLE, label: 'N′: block pushes ramp' },
    ],
    partners: { N_on_block: 'N_on_ramp', N_on_ramp: 'N_on_block' },
    extraBodies: { ramp: { label: 'Ramp', kind: 'ramp-body', x: 0.5, y: 0.72, w: 0.5, h: 0.05 } },
    note: 'The ramp pushes perpendicular to its own face, and the block pushes back on the ramp with an equal and opposite force on a different body.',
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
    note: "The contact pair is B pushing A up and A pushing B down, acting on different blocks. A's weight and B's push on A both act on A, so those two are not a pair.",
  },
  horsecart: {
    // The paradox pair: horse pulls cart forward ⇄ cart pulls horse backward.
    forces: [
      { id: 'T_on_cart', body: 'cart', type: 'tension', angle: 0, label: 'T: horse pulls cart →' },
      { id: 'T_on_horse', body: 'horse', type: 'tension', angle: 180, label: 'T′: cart pulls horse ←' },
      { id: 'f_ground', body: 'horse', type: 'friction', angle: 0, label: 'f: ground pushes horse →' },
    ],
    partners: { T_on_cart: 'T_on_horse', T_on_horse: 'T_on_cart' },
    note: 'The cart pulls back on the horse exactly as hard as the horse pulls the cart, but those two forces act on different bodies, so they never cancel. The system still accelerates because the ground pushes the horse forward, which is a separate pair.',
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* shared canvas geometry helpers                                              */
/* ────────────────────────────────────────────────────────────────────────── */

// Body center + half-extents in canvas px for a given W,H.
function bodyRect(b, W, H, theta = 0) {
  const hw = (b.w * W) / 2, hh = (b.h * H) / 2;
  let cx = b.x * W, cy = b.y * H;
  // A block on the incline sits ON the ramp face: find the surface height at its
  // x and lift the centre off the surface by half its height along the normal.
  // (Ramp geometry must match drawScenery.)
  if (b.kind === 'incline-block' && theta) {
    const ang = (theta * Math.PI) / 180;
    const baseY = H * 0.78, x0 = W * 0.07, runW = W * 0.86;
    const surfY = baseY - (cx - x0) * Math.tan(ang);
    cx -= hh * Math.sin(ang);
    cy = surfY - hh * Math.cos(ang);
  }
  return { cx, cy, hw, hh };
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
  const { dimBodies = [], highlightBody = null, theta = scene.surfaceAngle, offset = null, offsetBody = null, labels = true } = opts;
  ctx.save();

  // ground line for level scenes. Skip it when the scene already includes an
  // explicit surface body (pairs mode's "Table surface"), so there is only ONE
  // surface and the block rests directly on it.
  const hasSurfaceBody = Object.values(bodies).some((b) => b.kind === 'ground-body');
  if (theta === 0 && !hasSurfaceBody) {
    let gy = H * 0.66;
    // put ground just under the lowest body
    for (const b of Object.values(bodies)) {
      const r = bodyRect(b, W, H, theta);
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
  } else if (theta !== 0) {
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
    const base = bodyRect(b, W, H, theta);
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
      // A plain labelled block (a recognizable horse drawing added noise; the
      // physics is about the body, so keep it a clean block that rests on the
      // ground, distinguished from the cart by size and its label).
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      roundRect(ctx, r.cx - r.hw, r.cy - r.hh, r.hw * 2, r.hh * 2, 8);
      ctx.fill();
      ctx.stroke();
    } else if (b.kind === 'cart') {
      // A block on two wheels; the wheels sit on the ground line (r.cy + r.hh).
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      const wheelR = Math.min(11, r.hh * 0.32);
      roundRect(ctx, r.cx - r.hw, r.cy - r.hh, r.hw * 2, r.hh * 2 - wheelR, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = DEEP;
      for (const wx of [-0.58, 0.58]) {
        ctx.beginPath();
        ctx.arc(r.cx + wx * r.hw, r.cy + r.hh - wheelR, wheelR, 0, 2 * Math.PI);
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

    // (labels are drawn in a separate pass, on top of the force arrows)
    if (labels) {
      ctx.globalAlpha = dim ? 0.4 : 0.85;
      ctx.fillStyle = TEXT;
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.label, r.cx, r.cy - r.hh - 10);
      ctx.globalAlpha = 1;
    }
  }

  // rope / harness linking the horse and cart (only in that scene)
  if (bodies.horse && bodies.cart) {
    const hb = bodyRect(bodies.horse, W, H, theta);
    const cb = bodyRect(bodies.cart, W, H, theta);
    ctx.strokeStyle = 'rgba(197,183,131,0.7)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(hb.cx + hb.hw, hb.cy + hb.hh * 0.3);
    ctx.lineTo(cb.cx - cb.hw, cb.cy);
    ctx.stroke();
  }

  ctx.restore();
}

// Direction (physics degrees, +y up) pointing into the WIDEST angular gap between
// a body's force directions — i.e. the clearest place to put a label. With no
// forces it returns straight up.
function widestGapDir(angles) {
  if (!angles.length) return 90;
  const s = angles.map((a) => ((a % 360) + 360) % 360).sort((x, y) => x - y);
  let best = -1, mid = 90;
  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    const b = i + 1 < s.length ? s[i + 1] : s[0] + 360;
    if (b - a > best) { best = b - a; mid = (a + b) / 2; }
  }
  return ((mid % 360) + 360) % 360;
}

// A dark contrasting label pill centred at (x,y). Text colour is passed in so
// force labels can carry their force's colour while staying legible on any
// background.
function drawLabelPill(ctx, text, x, y, textColor = TEXT, alpha = 1) {
  const tw = ctx.measureText(text).width;
  const pw = tw + 12, ph = 18;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(13,19,33,0.9)';
  roundRect(ctx, x - pw / 2, y - ph / 2, pw, ph, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(139,140,142,0.4)';
  ctx.lineWidth = 1;
  roundRect(ctx, x - pw / 2, y - ph / 2, pw, ph, 5); ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Push a set of label pills apart so none overlap. Each label is {x,y,halfW,halfH};
// on every overlapping pair we separate along the axis of least penetration. A few
// passes settle it. Positions are nudged minimally, so labels stay near their
// intended spots.
function separateLabels(labels, iterations = 24) {
  const padX = 5, padY = 4;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const ox = a.halfW + b.halfW + padX - Math.abs(dx);
        const oy = a.halfH + b.halfH + padY - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) { const p = (ox / 2) * (dx < 0 ? -1 : 1); a.x -= p; b.x += p; }
          else { const p = (oy / 2) * (dy < 0 ? -1 : 1); a.y -= p; b.y += p; }
        }
      }
    }
    if (!moved) break;
  }
}

// A faint dotted leader from a label pill to its anchor (arrow tip or body), drawn
// only when the pill has been pushed clear of the anchor.
function drawLeader(ctx, l) {
  const dx = l.ax - l.x, dy = l.ay - l.y;
  const dist = Math.hypot(dx, dy);
  if (dist < l.halfW + 8) return;
  const ux = dx / dist, uy = dy / dist;
  ctx.save();
  ctx.globalAlpha = (l.alpha ?? 1) * 0.6;
  ctx.strokeStyle = 'rgba(139,140,142,0.8)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(l.x + ux * l.halfW, l.y + uy * l.halfH);
  ctx.lineTo(l.ax, l.ay);
  ctx.stroke();
  ctx.restore();
}

// Body-name labels, drawn AFTER the force arrows so they are never covered. Each
// pill is placed just OUTSIDE the block in the widest gap between its force
// arrows, so it avoids the arrows automatically instead of always sitting above.
function drawBodyLabels(ctx, bodies, W, H, theta, opts = {}) {
  const { dimBodies = [], offset = null, offsetBody = null, anglesFor = () => [] } = opts;
  ctx.save();
  ctx.font = 'bold 12px JetBrains Mono, monospace';
  for (const [key, b] of Object.entries(bodies)) {
    if (!b.label) continue;
    const base = bodyRect(b, W, H, theta);
    const d = offset && offsetBody === key ? offset : { x: 0, y: 0 };
    const cx = base.cx + d.x, cy = base.cy + d.y, hw = base.hw, hh = base.hh;
    // place the pill outside the body edge along the clearest direction
    const dir = (widestGapDir(anglesFor(key)) * Math.PI) / 180;
    const ux = Math.cos(dir), uy = -Math.sin(dir); // screen (+y down)
    const tE = Math.min(hw / Math.max(1e-3, Math.abs(ux)), hh / Math.max(1e-3, Math.abs(uy)));
    const lx = cx + ux * (tE + 16);
    const ly = cy + uy * (tE + 13);
    drawLabelPill(ctx, b.label, lx, ly, TEXT, dimBodies.includes(key) ? 0.45 : 1);
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

  // Replace the current diagram with the scene's exact correct forces.
  const snapToCorrect = () => {
    setForces(expected.map((e) => ({
      uid: `${e.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: e.type, angle: e.angle, mag: e.mag,
    })));
    setSelected(null);
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
      // Freeze the drift WHILE a tip is being dragged. Otherwise the body moves
      // under the pointer, which shifts the vector's reference point, which
      // changes the net force, which flips the balance — a feedback loop that
      // makes the state oscillate right at the balance point.
      const drift = driftRef.current;
      const dragging = !!dragRef.current;
      if (!dragging && !balanced && netMag > BALANCE_EPS) {
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
        labels: false,
      });

      const rBase = bodyRect(target, W, H, th);
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
          // on-canvas delete handle (× above-right of the selected tip)
          if (isSel) {
            const hx = r.cx + dx + 16, hy = r.cy + dy - 16;
            ctx.save();
            ctx.fillStyle = '#3A2530';
            ctx.strokeStyle = '#E86A5C';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(hx, hy, 8, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(hx - 3.2, hy - 3.2); ctx.lineTo(hx + 3.2, hy + 3.2);
            ctx.moveTo(hx + 3.2, hy - 3.2); ctx.lineTo(hx - 3.2, hy + 3.2);
            ctx.stroke();
            ctx.restore();
          }
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
          drawBalancedBadge(ctx, r.cx, r.cy - bodyRect(target, W, H, th).hh - 30);
        }
      }

      // body-name labels last, placed in the clear gap between the forces
      if (!polygonRef.current) {
        drawBodyLabels(ctx, scene.bodies, W, H, th, {
          anglesFor: (k) => (k === scene.target ? list.map((f) => f.angle) : []),
          offset: drift, offsetBody: scene.target,
        });
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
      const rBase = bodyRect(target, W, H, thetaRef.current);
      const d = driftRef.current;
      const r = { cx: rBase.cx + d.x, cy: rBase.cy + d.y };
      const p = localPt(ev);
      const list = forcesRef.current;
      // (0) delete handle on the currently-selected force's tip
      const selUid = selRef.current;
      if (selUid != null) {
        const sf = list.find((x) => x.uid === selUid);
        if (sf) {
          const { dx, dy } = polar(sf.angle, sf.mag);
          const hx = r.cx + dx + 16, hy = r.cy + dy - 16;
          if (Math.hypot(p.x - hx, p.y - hy) < 12) {
            setForces((f) => f.filter((x) => x.uid !== selUid));
            setSelected(null);
            setFeedback(null);
            ev.preventDefault();
            return;
          }
        }
      }
      // hit-test tips (topmost wins → iterate reversed)
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
      // Aim relative to the body's HOME centre (not the drifting one) so the
      // vector is stable while the meter animates — no balance-point oscillation.
      const rBase = bodyRect(target, W, H, thetaRef.current);
      const p = localPt(ev);
      const dx = p.x - rBase.cx, dy = p.y - rBase.cy;
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

  /* ── keyboard: Delete / Backspace removes the selected force ───────────── */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current != null) {
        const uid = selRef.current;
        setForces((f) => f.filter((x) => x.uid !== uid));
        setSelected(null);
        setFeedback(null);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          const rBase = bodyRect(target, W, H, thetaRef.current);
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
              className="mt-1 w-full py-1.5 rounded text-xs font-semibold bg-red-900/30 text-red-200 hover:bg-red-900/50 border border-red-800/70 transition-colors"
            >
              ✕ Remove this force
            </button>
            <div className="text-usna-muted text-[11px] mt-1 leading-snug">
              Or click the ✕ on its tip, or press Delete.
            </div>
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
            onClick={snapToCorrect}
            className="w-full py-2 rounded text-sm font-medium border border-usna-grid bg-usna-deep text-usna-text hover:border-green-500 hover:text-green-200 transition-colors"
          >
            Snap to correct forces
          </button>
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
            {balanced ? '⚖ Balanced · a = 0'
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
        <div className="flex items-start gap-2 rounded-lg border border-usna-gold/40 bg-usna-gold/10 px-3 py-2">
          <span className="mt-0.5 px-2 py-0.5 rounded bg-usna-gold text-usna-navy font-semibold text-[11px] shrink-0">TASK</span>
          <span className="text-usna-text text-sm">{scene.task}</span>
        </div>
        <div
          ref={wrapRef}
          className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
          style={{ height: 440, touchAction: 'none' }}
        >
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 left-3 text-xs font-mono text-usna-muted pointer-events-none">
            {polygon ? 'tip-to-tail: closed polygon ⇒ ΣF = 0' : "drag a tip to aim · click ✕ or press Delete to remove"}
          </div>
          {forces.length === 0 && !polygon && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-usna-muted text-sm bg-usna-deep/70 px-4 py-2 rounded">
                Tap a force in the palette to start building the diagram
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

  // Walk the vectors in ANGULAR order (not add-order). Adding them tip-to-tail
  // by direction sweeps a proper closed polygon; the raw order tends to pair a
  // force with its cancelling opposite and collapse the path onto a line.
  const norm = (a) => ((a % 360) + 360) % 360;
  const ordered = [...list].sort((a, b) => norm(a.angle) - norm(b.angle));
  for (const f of ordered) {
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
      drawBalancedBadge(ctx, ox, oy - 40, 'closed · ΣF = 0');
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
function drawBalancedBadge(ctx, x, y, text = '⚖ balanced · a = 0') {
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
    const r = bodyRect(b, W, H, theta);
    return { x: r.cx, y: r.cy };
  }, [bodies, theta]);

  // Fit transform (scale + translate) so the whole scene stays in frame.
  const fitRef = useRef({ s: 1, tx: 0, ty: 0 });

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

      // ── precompute each force's geometry + a label position ──
      // The label pill sits BESIDE the arrowhead (perpendicular to the shaft), on
      // whichever side keeps it furthest inside the frame — so it never runs down
      // the shaft or straight into a neighbouring body.
      ctx.font = 'bold 12px JetBrains Mono, monospace';
      const fdata = pair.forces.map((f) => {
        const o = forceOrigin(f, W, H);
        const { dx, dy } = polar(f.angle, 92);
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const tipX = o.x + dx, tipY = o.y + dy;
        const halfW = (ctx.measureText(f.label).width + 12) / 2;
        const off = halfW + 8;
        const px = -uy, py = ux; // perpendicular
        const c1 = { x: tipX + px * off, y: tipY + py * off };
        const c2 = { x: tipX - px * off, y: tipY - py * off };
        const edge = (c) => Math.min(c.x, W - c.x, c.y, H - c.y);
        const lab = edge(c1) >= edge(c2) ? c1 : c2;
        return { f, o, dx, dy, tipX, tipY, lab, halfW };
      });

      // colour / alpha for a force id
      const forceColor = (f) => {
        if (!sel) return FORCE_TYPES[f.type].color;
        if (f.id === sel) return GOLD;
        if (f.id === partner) return GREEN;
        return FORCE_TYPES[f.type].color;
      };
      const forceAlpha = (f) => (sel && f.id !== sel && f.id !== partner ? 0.25 : 1);

      // ── build every label (force + body) as a movable pill, then de-overlap ──
      const labels = [];
      for (const d of fdata) {
        labels.push({
          text: d.f.label, x: d.lab.x, y: d.lab.y, ax: d.tipX, ay: d.tipY,
          halfW: d.halfW, halfH: 9, color: forceColor(d.f), alpha: forceAlpha(d.f),
        });
      }
      for (const [key, b] of Object.entries(bodiesRef.current)) {
        if (!b.label) continue;
        const br = bodyRect(b, W, H, theta);
        const angs = pair.forces.filter((f) => f.body === key).map((f) => f.angle);
        const dir = (widestGapDir(angs) * Math.PI) / 180;
        const ux = Math.cos(dir), uy = -Math.sin(dir);
        const tE = Math.min(br.hw / Math.max(1e-3, Math.abs(ux)), br.hh / Math.max(1e-3, Math.abs(uy)));
        labels.push({
          text: b.label, x: br.cx + ux * (tE + 16), y: br.cy + uy * (tE + 13),
          ax: br.cx, ay: br.cy,
          halfW: (ctx.measureText(b.label).width + 12) / 2, halfH: 9,
          color: TEXT, alpha: dimBodies.includes(key) ? 0.45 : 1,
        });
      }
      separateLabels(labels);

      // ── fit the scene (bodies + arrows + FINAL label pills) into the frame ──
      const margin = 18;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const acc = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
      for (const key of Object.keys(bodiesRef.current)) {
        const r = bodyRect(bodiesRef.current[key], W, H, theta);
        acc(r.cx - r.hw, r.cy - r.hh); acc(r.cx + r.hw, r.cy + r.hh);
      }
      for (const d of fdata) { acc(d.o.x, d.o.y); acc(d.tipX, d.tipY); }
      for (const l of labels) { acc(l.x - l.halfW, l.y - l.halfH); acc(l.x + l.halfW, l.y + l.halfH); }
      const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
      const s = Math.min(1, (W - 2 * margin) / bw, (H - 2 * margin) / bh);
      const tx = W / 2 - s * (minX + maxX) / 2;
      const ty = H / 2 - s * (minY + maxY) / 2;
      fitRef.current = { s, tx, ty };

      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(s, s);
      drawScenery(ctx, scene, bodiesRef.current, W, H, { dimBodies, theta, labels: false });

      // arrows + tip dots (no inline labels)
      for (const d of fdata) {
        const isHi = d.f.id === sel || d.f.id === partner;
        const color = forceColor(d.f), alpha = forceAlpha(d.f);
        ctx.save();
        ctx.globalAlpha = alpha;
        if (isHi) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
        drawArrow(ctx, { x: d.o.x, y: d.o.y, dx: d.dx, dy: d.dy, color, width: isHi ? 5.5 : 3.5, head: 13 });
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = isHi ? TEXT : color;
        ctx.beginPath(); ctx.arc(d.tipX, d.tipY, 6, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
      }

      // connecting brace between a selected pair
      if (sel && partner) {
        const sf = fdata.find((d) => d.f.id === sel);
        const pf = fdata.find((d) => d.f.id === partner);
        if (sf && pf) {
          ctx.save();
          ctx.setLineDash([4, 6]);
          ctx.strokeStyle = 'rgba(197,183,131,0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sf.o.x, sf.o.y);
          ctx.lineTo(pf.o.x, pf.o.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // leaders then pills, on top of everything
      for (const l of labels) drawLeader(ctx, l);
      for (const l of labels) drawLabelPill(ctx, l.text, l.x, l.y, l.color, l.alpha);

      ctx.restore(); // end fit transform

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
      // undo the fit transform so hit-testing matches what is drawn
      const { s, tx, ty } = fitRef.current;
      const px = (ev.clientX - rect.left - tx) / s;
      const py = (ev.clientY - rect.top - ty) / s;
      const { W, H } = geomRef.current;
      // topmost first
      for (let i = pair.forces.length - 1; i >= 0; i--) {
        const f = pair.forces[i];
        const b = bodies[f.body];
        const r = bodyRect(b, W, H, theta);
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
            {partnerForce ? (
              <>
                <div className="rounded bg-usna-deep border border-usna-grid p-2 text-xs leading-snug mb-2">
                  <div>
                    <span className="text-usna-gold font-medium">{selForce.label}</span>
                    <span className="text-usna-muted"> acts on {bodies[selForce.body].label}</span>
                  </div>
                  <div className="text-usna-muted text-center my-1">⇕ equal and opposite</div>
                  <div>
                    <span className="text-green-300 font-medium">{partnerForce.label}</span>
                    <span className="text-usna-muted"> acts on {bodies[partnerForce.body].label}</span>
                  </div>
                </div>
                <div className="text-usna-muted text-xs leading-snug">
                  Same size, opposite direction, but acting on different bodies, so
                  the pair can never cancel on one body's free-body diagram.
                </div>
              </>
            ) : (
              <>
                <div className="text-usna-gold font-medium mb-1">{selForce.label}</div>
                <div className="text-usna-muted text-xs leading-snug">
                  Its third-law partner acts on a body that is off-screen (the Earth,
                  for weight). It is still equal and opposite.
                </div>
              </>
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
// DPR capped at 2 (matches shared MAX_DPR): a no-op on desktop (dpr 1–2), but on
// phones (dpr 3) it cuts per-frame fill cost so taps aren't starved by the loop.
function setupCanvasLocal(canvas, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    'A free-body diagram shows every force acting on the body, and nothing else. Add each force from the palette, drag its tip to aim and size it, and watch the net force update. The instructive case is the incline: weight is always straight down, but the normal force tilts with the ramp and shrinks (N = W·cos θ) while friction along the slope grows (f = W·sin θ). Get all three right and the diagram closes to a net force of about zero, and the equilibrium meter turns green. Switch to the tip-to-tail polygon to see that closure geometrically, use the incline-angle slider to explore the whole family, and use Check and then Show me for force-by-force guidance.',
  equation: String.raw`\vec F_{net} = \sum \vec F_i = m\,\vec a, \qquad N = W\cos\theta,\; f = W\sin\theta`,
};

const PAIRS_INFO = {
  title: "Newton's third law: partners live on different bodies",
  description:
    'For every force there is an equal and opposite reaction, but the two act on different bodies, so they can never cancel on a single free-body diagram. Click a force to light up its partner across the gap. The horse-and-cart case is the payoff: the cart pulls back on the horse exactly as hard as the horse pulls the cart, yet the cart still accelerates, because that reaction acts on the horse rather than the cart, while the ground pushes the horse forward.',
  equation: String.raw`\vec F_{A\to B} = -\,\vec F_{B\to A}`,
};
