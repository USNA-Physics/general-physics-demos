/**
 * chaosWorker.js — off-main-thread sweeps for the Chaotic Pendulum Explorer.
 *
 * `bifurcation` and `basins` each integrate many thousands of trajectories and
 * cannot run inside the rAF budget, so they live here. Results stream back
 * row-by-row (bifurcation) / line-by-line (basins) with a progress fraction, so
 * the UI renders progressively and shows a bar.
 *
 * Cancellation: the main thread stamps every request with a monotonically
 * increasing `reqId`. Any newer message supersedes older work — a runner yields
 * to the event loop periodically (`await yieldLoop()`), and on resuming checks
 * whether its reqId is still current; if not it stops. The main thread also
 * ignores any message whose reqId is stale. This keeps a dragged slider from
 * piling up long sweeps.
 *
 * Vite bundles this via `new Worker(new URL('./chaosWorker.js', import.meta.url),
 * { type: 'module' })`, so it imports the shared integrator directly — the
 * sweeps use the EXACT same RK4 as the live trajectory (just a coarser substep,
 * passed in as `subs`, since the maps only need qualitative accuracy).
 */
import { stepOnePeriod, wrapPi } from './chaosPhysics';

let currentReq = -1;
const alive = (r) => r === currentReq;
const yieldLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

self.onmessage = (e) => {
  const m = e.data;
  currentReq = m.reqId;                 // any new message supersedes older work
  if (m.type === 'bifurcation') runBifurcation(m.reqId, m.params);
  else if (m.type === 'basins') runBasins(m.reqId, m.params);
};

/**
 * 1-D sweep: for each drive amplitude A, discard a transient then collect the
 * strobed wrapped angle θ once per drive period. Streams a batch of columns at a
 * time so the diagram fills left to right.
 */
async function runBifurcation(reqId, p) {
  const { Q, Om, aMin, aMax, aSteps, settle, samples, th0, w0, subs } = p;
  let batch = [];
  for (let i = 0; i < aSteps; i++) {
    const A = aMin + (aMax - aMin) * (i / (aSteps - 1));
    let s = [th0, w0], t = 0;
    for (let k = 0; k < settle; k++) [s, t] = stepOnePeriod(s, t, Q, A, Om, subs);
    const thetas = new Float32Array(samples);
    for (let k = 0; k < samples; k++) { [s, t] = stepOnePeriod(s, t, Q, A, Om, subs); thetas[k] = wrapPi(s[0]); }
    batch.push({ A, thetas });
    if (batch.length >= 8 || i === aSteps - 1) {
      self.postMessage({ type: 'bifurcation-rows', reqId, rows: batch, done: i === aSteps - 1, progress: (i + 1) / aSteps });
      batch = [];
      await yieldLoop(); if (!alive(reqId)) return;
    }
  }
}

/**
 * 2-D sweep: a grid of initial conditions (θ₀, ω₀), each classified by its net
 * rotation per drive period after a transient into
 *   0 = librating / non-rotating, 1 = net clockwise, 2 = net counter-clockwise.
 * The boundary between basins is the fractal of interest. Streams one grid line
 * (a full row of ω₀) at a time.
 */
async function runBasins(reqId, p) {
  const { Q, A, Om, th0Min, th0Max, w0Min, w0Max, nx, ny, settle, avgPeriods, rotThresh, subs } = p;
  for (let j = 0; j < ny; j++) {
    const w0 = w0Max - (w0Max - w0Min) * (j / (ny - 1)); // top row = high ω₀
    const row = new Uint8Array(nx);
    for (let i = 0; i < nx; i++) {
      const th0 = th0Min + (th0Max - th0Min) * (i / (nx - 1));
      let s = [th0, w0], t = 0;
      for (let k = 0; k < settle; k++) [s, t] = stepOnePeriod(s, t, Q, A, Om, subs);
      const thStart = s[0];
      for (let k = 0; k < avgPeriods; k++) [s, t] = stepOnePeriod(s, t, Q, A, Om, subs);
      const winding = (s[0] - thStart) / avgPeriods; // net angle advanced per drive period
      row[i] = winding > rotThresh ? 1 : winding < -rotThresh ? 2 : 0;
    }
    self.postMessage({ type: 'basins-row', reqId, j, row, done: j === ny - 1, progress: (j + 1) / ny });
    if ((j & 3) === 0) { await yieldLoop(); if (!alive(reqId)) return; }
  }
}
