import { useState, useRef, useEffect, useMemo } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import EnergyBars from '@shared/components/EnergyBars';
import { setupCanvas } from '@shared/lib/canvas';
import { byKey, rollingAccel, rotationalKEFraction } from '@shared/lib/shapes';

/**
 * D28 · Rolling Race (L28) — hoop vs. disk vs. solid sphere down an incline.
 *
 * The whole demo is built around ONE equation and one betrayal of intuition.
 * Every rolling body accelerates down the ramp at
 *
 *        a = g sinθ / (1 + c),        c = I / (m r²)
 *
 * so the finishing order depends ONLY on c — the dimensionless "how far out is
 * the mass" number — and NOT on the mass or radius the student is invited to
 * crank. The student VOTES before release; almost everyone picks the biggest or
 * heaviest racer. The solid sphere (smallest c = 2/5) wins every single time.
 *
 * The live energy bars are the "why": as each body descends, its kinetic energy
 * splits into translational (fraction 1/(1+c)) and rotational (fraction c/(1+c))
 * shares. The hoop (c = 1) dumps HALF of its energy budget into spin, starving
 * the translation that actually moves it down the hill; the sphere keeps most of
 * its energy in forward motion.
 *
 * Follow-up: the "frictionless ice" toggle removes the torque provider. With no
 * friction there is no torque, nothing rolls, and every body slides at the same
 * a = g sinθ — a dead heat — isolating friction as the thing that made the race
 * a race at all.
 *
 * ── Enhancements (D28) ──────────────────────────────────────────────────────
 *  • Reservoir drain (WOW): each lane carries a gravitational-PE reservoir at
 *    the top of the ramp that visibly drains into two collecting tanks —
 *    K_trans and K_rot — as the body descends. The stream forks in proportion
 *    to 1/(1+c) vs c/(1+c), so the hoop is *seen* siphoning half its budget
 *    into the spin tank while the sphere pours almost everything into motion.
 *  • Photo-finish (WOW): after the tape, an ordered strip lists finishers with
 *    Δt gaps ("sphere +0.00 s, disk +0.21 s, hoop +0.42 s").
 *  • Class-poll tally (INTERACT): every cast vote is tallied per racer so an
 *    instructor can poll the room ("hands up for the hoop") and the counts stay
 *    visible — the vote is the lesson.
 *  • Mystery racer (CUSTOMIZE): an unlabeled entrant with a hidden c drawn from
 *    {solid sphere, disk, shell, hoop}. Students race it and infer solid-vs-
 *    hollow purely from where it finishes; the identity reveals after the race.
 *  • Slip warning (PHYSICS): rolling-without-slipping needs μ_s ≥ (c/(1+c))tanθ.
 *    We report the required μ and the critical angle θ_slip = atan(μ (1+c)/c)
 *    for the assumed μ, making the idealization's breaking point explicit.
 *
 * Self-contained canvas (setupCanvas + rAF + ResizeObserver); mode: default.
 */

// USNA palette (hex for canvas; classes elsewhere)
const NAVY = '#00205B';
const GOLD = '#C5B783';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const DEEP = '#0D1321';
const GRID = '#1A2332';

const G = 9.81;

// One distinct color per racer so canvas, bars, and vote UI stay legible.
const RACER_COLOR = {
  hoop: '#E06666',      // red
  cylinder: '#5B9BD5',  // blue
  sphere: '#7FB77E',    // green
  shell: '#C08BE0',     // violet
  mystery: '#E8C46A',   // amber — the unknown c
};

// Racers this demo can enter. All roll; the classic three are on by default.
// "mystery" is a special entrant whose c is hidden until the race resolves.
const RACERS = ['hoop', 'cylinder', 'sphere', 'shell', 'mystery'];

// Candidate identities the mystery racer can secretly adopt.
const MYSTERY_POOL = ['sphere', 'cylinder', 'shell', 'hoop'];

const DEFAULTS = {
  angle: 20,                 // incline angle (deg)
  mass: 2,                   // kg — a red herring
  radius: 0.15,              // m — a red herring
  mu: 0.4,                   // assumed coefficient of static friction (for slip warning)
  entrants: { hoop: true, cylinder: true, sphere: true, shell: false, mystery: false },
  ice: false,                // frictionless-ice follow-up
};

// c for a racer key. The mystery racer resolves against its hidden identity.
const cOf = (key, mysteryId) =>
  key === 'mystery' ? byKey[mysteryId].cInertia : byKey[key].cInertia;

// Short display label for a racer key. The mystery racer stays anonymous until
// revealed (revealId non-null).
const shortLabel = (key, revealId = null) => {
  if (key === 'mystery') {
    return revealId ? `Mystery = ${labelClean(revealId)}` : 'Mystery racer';
  }
  return labelClean(key);
};

const labelClean = (key) =>
  byKey[key].label.replace(' / ring', '').replace(' / disk', '');

export default function RollingRace({ mode = 'default' }) {
  const [angle, setAngle] = useState(DEFAULTS.angle);
  const [mass, setMass] = useState(DEFAULTS.mass);
  const [radius, setRadius] = useState(DEFAULTS.radius);
  const [mu, setMu] = useState(DEFAULTS.mu);
  const [entrants, setEntrants] = useState({ ...DEFAULTS.entrants });
  const [ice, setIce] = useState(DEFAULTS.ice);

  const [vote, setVote] = useState(null);   // racer key the student bet on
  const [poll, setPoll] = useState({});     // { key: count } — class-poll tally
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [winner, setWinner] = useState(null);

  // Photo-finish order captured at the tape: [{ key, t, delta }] sorted fastest→slowest.
  const [finishOrder, setFinishOrder] = useState([]);

  // The mystery racer's hidden identity, chosen fresh each race. `mysteryReveal`
  // flips true once the race resolves so the identity can be shown.
  const [mysteryId, setMysteryId] = useState(MYSTERY_POOL[0]);
  const [mysteryReveal, setMysteryReveal] = useState(false);

  // Live per-racer state published from the rAF loop for the bars/readouts,
  // throttled to keep React out of the hot path.
  const [live, setLive] = useState({});     // { key: { s, v, kTrans, kRot, done } }

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  // Refs mirror the controls so the animation loop reads fresh values without
  // re-subscribing the effect on every slider tick.
  const angleRef = useRef(angle); angleRef.current = angle;
  const massRef = useRef(mass); massRef.current = mass;
  const radiusRef = useRef(radius); radiusRef.current = radius;
  const iceRef = useRef(ice); iceRef.current = ice;
  const runningRef = useRef(running); runningRef.current = running;
  const entrantsRef = useRef(entrants); entrantsRef.current = entrants;
  const mysteryIdRef = useRef(mysteryId); mysteryIdRef.current = mysteryId;

  const activeKeys = useMemo(
    () => RACERS.filter((k) => entrants[k]),
    [entrants]
  );

  const reset = () => {
    setAngle(DEFAULTS.angle);
    setMass(DEFAULTS.mass);
    setRadius(DEFAULTS.radius);
    setMu(DEFAULTS.mu);
    setEntrants({ ...DEFAULTS.entrants });
    setIce(DEFAULTS.ice);
    setVote(null);
    setPoll({});
    setRunning(false);
    setFinished(false);
    setWinner(null);
    setFinishOrder([]);
    setMysteryReveal(false);
    setLive({});
  };

  const toggleEntrant = (key) => {
    if (running) return;
    setEntrants((e) => {
      const next = { ...e, [key]: !e[key] };
      // never let the field go empty
      if (!RACERS.some((k) => next[k])) return e;
      return next;
    });
    if (vote === key && entrants[key]) setVote(null); // dropped your pick
    setFinished(false);
    setWinner(null);
    setFinishOrder([]);
    setMysteryReveal(false);
    setLive({});
  };

  // Cast a vote AND tally it into the class poll (the vote is the lesson).
  const castVote = (key) => {
    if (running) return;
    setVote(key);
    setPoll((p) => ({ ...p, [key]: (p[key] || 0) + 1 }));
  };

  const start = () => {
    // draw a fresh hidden identity for the mystery racer each race
    if (entrants.mystery) {
      const id = MYSTERY_POOL[Math.floor(Math.random() * MYSTERY_POOL.length)];
      setMysteryId(id);
      mysteryIdRef.current = id;
    }
    setMysteryReveal(false);
    setFinished(false);
    setWinner(null);
    setFinishOrder([]);
    setLive({});
    setRunning(true);
  };

  // ── the race: one rAF loop drives both the canvas and the energy bars ─────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf;
    let simT = 0, lastNow = null, lastPublish = 0;
    let sim = null;           // per-race frozen snapshot of the racers
    let lastRunning = false;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    // Freeze the racer set + parameters at the moment of release. Length of the
    // ramp track (world meters) is fixed; the finish is the bottom of the ramp.
    const buildSim = () => {
      const keys = RACERS.filter((k) => entrantsRef.current[k]);
      const trackLen = 3.0;   // meters of travel down the slope
      const theta = angleRef.current;
      const m = massRef.current;
      const r = radiusRef.current;
      const onIce = iceRef.current;
      const mystId = mysteryIdRef.current;
      const racers = keys.map((k, i) => {
        const c = cOf(k, mystId);
        // frictionless ice → no torque → pure sliding, a = g sinθ for all.
        const a = onIce
          ? G * Math.sin((theta * Math.PI) / 180)
          : rollingAccel(c, theta);
        // total mechanical energy budget = PE dropped over the full track.
        const peTotal = m * G * trackLen * Math.sin((theta * Math.PI) / 180);
        return {
          key: k, c, a, r, m, lane: i,
          s: 0, v: 0, done: false, tFinish: null, peTotal,
        };
      });
      return { keys, trackLen, theta, m, r, onIce, mystId, racers };
    };

    const publish = () => {
      const next = {};
      if (sim) {
        for (const rc of sim.racers) {
          // KE via energy conservation: total = m g s sinθ (rolling or sliding).
          const total = rc.m * G * rc.s * Math.sin((sim.theta * Math.PI) / 180);
          const rotFrac = sim.onIce ? 0 : rotationalKEFraction(rc.c);
          next[rc.key] = {
            s: rc.s,
            v: rc.v,
            kRot: total * rotFrac,
            kTrans: total * (1 - rotFrac),
            done: rc.done,
          };
        }
      }
      setLive(next);
    };

    const draw = (now) => {
      // Start / restart of a race: rebuild the frozen snapshot.
      if (runningRef.current && !lastRunning) {
        sim = buildSim();
        simT = 0;
        lastNow = now;
      }
      lastRunning = runningRef.current;

      // bounded dt so the sim survives tab throttling
      let dt = lastNow == null ? 1 / 60 : (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      if (runningRef.current && sim) {
        simT += dt;
        let allDone = true;
        for (const rc of sim.racers) {
          if (!rc.done) {
            rc.v = rc.a * simT;
            rc.s = 0.5 * rc.a * simT * simT;
            if (rc.s >= sim.trackLen) {
              rc.s = sim.trackLen;
              rc.v = Math.sqrt(2 * rc.a * sim.trackLen);
              rc.done = true;
              rc.tFinish = simT;
            } else {
              allDone = false;
            }
          }
        }
        if (allDone) {
          // resolve the winner (smallest finish time) and stop the clock
          const sorted = [...sim.racers].sort((a, b) => a.tFinish - b.tFinish);
          const t0 = sorted[0].tFinish;
          runningRef.current = false;
          // hop the React state out of the render loop
          setRunning(false);
          setFinished(true);
          setWinner(sim.onIce ? null : sorted[0].key);
          // photo-finish order + deltas relative to the leader
          setFinishOrder(
            sorted.map((rc) => ({ key: rc.key, t: rc.tFinish, delta: rc.tFinish - t0 }))
          );
          setMysteryReveal(true);
          publish();
        }
      }

      // throttle the bar/readout state to ~20 Hz
      if (now - lastPublish > 50 && runningRef.current && sim) {
        lastPublish = now;
        publish();
      }

      drawScene(ctx, W, H, sim, angleRef.current, iceRef.current, mysteryIdRef.current);
      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The rAF loop redraws every frame and reads live values through refs, so the
  // idle starting-line preview updates as sliders/entrants change with no extra
  // effect needed here.
  const votedCorrect = winner && vote === winner;

  // Total votes cast across the class poll (for percentage bars).
  const pollTotal = useMemo(
    () => Object.values(poll).reduce((s, n) => s + n, 0),
    [poll]
  );

  // Slip physics for the currently displayed racers (idealization limit).
  // Rolling without slipping requires the static friction the surface must
  // supply, f = (c/(1+c)) m g sinθ, to stay below μ m g cosθ, i.e.
  //     μ_s ≥ (c/(1+c)) tanθ  ⇔  θ ≤ θ_slip = atan( μ (1+c)/c ).
  const tanTheta = Math.tan((angle * Math.PI) / 180);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {/* ── who's racing ─────────────────────────────────────────────── */}
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Enter the race</div>
          <div className="flex flex-col gap-1.5">
            {RACERS.map((k) => {
              const on = entrants[k];
              const col = RACER_COLOR[k];
              const isMystery = k === 'mystery';
              return (
                <button
                  key={k}
                  onClick={() => toggleEntrant(k)}
                  disabled={running}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left border transition-colors disabled:opacity-50 ${
                    on
                      ? 'bg-usna-deep text-usna-text border-usna-grid'
                      : 'bg-transparent text-usna-muted border-usna-grid hover:text-usna-text'
                  }`}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-full shrink-0"
                    style={{ background: on ? col : 'transparent', border: `1.5px solid ${col}` }}
                  />
                  <span className="flex-1">{shortLabel(k)}</span>
                  <span className="font-mono text-xs text-usna-muted">
                    {isMystery ? 'c = ?' : `c=${fmtC(byKey[k].cInertia)}`}
                  </span>
                </button>
              );
            })}
          </div>
          {entrants.mystery && (
            <div className="text-usna-muted text-xs mt-1.5 leading-snug">
              The mystery racer hides its c. Race it and read the order — where it
              lands tells you solid vs. hollow.
            </div>
          )}
        </div>

        {/* ── the vote (with live class-poll tally) ────────────────────── */}
        <div className="mb-4 border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-1">Cast your vote</div>
          <div className="text-usna-muted text-xs mb-2">
            Which one reaches the bottom first? {pollTotal > 0 && `(${pollTotal} cast)`}
          </div>
          <div className="flex flex-col gap-1.5">
            {activeKeys.map((k) => {
              const picked = vote === k;
              const col = RACER_COLOR[k];
              const count = poll[k] || 0;
              const pct = pollTotal > 0 ? (count / pollTotal) * 100 : 0;
              return (
                <button
                  key={k}
                  onClick={() => castVote(k)}
                  disabled={running}
                  className={`relative overflow-hidden px-3 py-1.5 rounded text-sm text-left border transition-colors disabled:opacity-50 ${
                    picked
                      ? 'border-usna-gold text-usna-navy'
                      : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                  }`}
                  style={picked ? { background: GOLD } : undefined}
                >
                  {/* poll fill bar behind the label (only when not the picked/gold row) */}
                  {!picked && count > 0 && (
                    <span
                      className="absolute inset-y-0 left-0 pointer-events-none"
                      style={{ width: `${pct}%`, background: hexWithAlpha(col, 0.28) }}
                    />
                  )}
                  <span className="relative flex items-center justify-between gap-2">
                    <span>{picked ? '★ ' : ''}{shortLabel(k)}</span>
                    {count > 0 && (
                      <span className="font-mono text-xs opacity-80">
                        {count} · {Math.round(pct)}%
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {pollTotal > 0 && (
            <button
              onClick={() => setPoll({})}
              disabled={running}
              className="mt-1.5 text-xs text-usna-muted hover:text-usna-text underline disabled:opacity-40"
            >
              clear tally
            </button>
          )}
        </div>

        {/* ── release / reset race ─────────────────────────────────────── */}
        <div className="mb-4 border-t border-usna-grid pt-3">
          <button
            onClick={running ? undefined : start}
            disabled={running || !vote}
            className="w-full py-2 rounded text-sm font-semibold bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors disabled:opacity-40"
          >
            {running ? 'Racing…' : '▶ Release!'}
          </button>
          {!vote && !running && (
            <div className="text-usna-muted text-xs mt-1.5">Pick a racer to enable release.</div>
          )}
        </div>

        {/* ── incline + red-herring dials ──────────────────────────────── */}
        <div className="border-t border-usna-grid pt-3">
          <Slider label="Incline angle (θ)" value={angle} min={5} max={40} step={1} unit="°" onChange={setAngle} />
          <Slider label="Mass (m)" value={mass} min={0.5} max={10} step={0.5} unit="kg" onChange={setMass} />
          <Slider label="Radius (r)" value={radius} min={0.05} max={0.4} step={0.01} unit="m" onChange={setRadius} />
          <div className="text-usna-muted text-xs mt-1 leading-snug">
            Try changing mass and radius, then race again — the order never moves.
          </div>
        </div>

        {/* ── slip warning: friction the idealization silently assumes ───── */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          <Slider label="Static friction (μ_s)" value={mu} min={0.05} max={1.0} step={0.05} unit="" onChange={setMu} />
          <div className="text-usna-muted text-xs mt-1 leading-snug">
            Rolling without slipping needs μ_s ≥ (c/(1+c)) tanθ. Above the
            critical angle the surface can't grip and the body starts to skid.
          </div>
          {!ice && (
            <div className="mt-2 flex flex-col gap-1">
              {activeKeys.map((k) => {
                const c = k === 'mystery'
                  ? cOf(k, mysteryId)          // pre-race: uses current draw (harmless)
                  : byKey[k].cInertia;
                if (k === 'mystery' && !mysteryReveal) {
                  return (
                    <div key={k} className="text-xs font-mono text-usna-muted">
                      mystery · slip limit hidden
                    </div>
                  );
                }
                const muNeed = (c / (1 + c)) * tanTheta;
                const thetaSlip = (Math.atan((mu * (1 + c)) / c) * 180) / Math.PI;
                const slipping = mu < muNeed;
                return (
                  <div key={k} className="flex items-center justify-between gap-2 text-xs font-mono">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: RACER_COLOR[k] }} />
                      <span className="text-usna-muted">{shortLabel(k, mysteryReveal ? mysteryId : null)}</span>
                    </span>
                    <span style={{ color: slipping ? '#E06666' : MUTED }}>
                      {slipping ? '⚠ slips' : `≤ ${thetaSlip.toFixed(0)}°`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── frictionless ice follow-up ───────────────────────────────── */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ice}
              disabled={running}
              onChange={(e) => {
                setIce(e.target.checked);
                setFinished(false); setWinner(null); setFinishOrder([]);
                setMysteryReveal(false); setLive({});
              }}
              className="accent-usna-gold w-4 h-4"
            />
            <span className="text-usna-text text-sm font-medium">Frictionless ice</span>
          </label>
          <div className="text-usna-muted text-xs mt-1 leading-snug">
            No friction → no torque → nothing spins. Everything slides down tied.
          </div>
        </div>
      </ControlPanel>

      {/* ── content column ─────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {/* the ramp */}
        <div
          ref={wrapRef}
          className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
          style={{ height: 360, background: DEEP }}
        >
          <canvas ref={canvasRef} className="block" />
          {/* result banner */}
          {finished && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-md border text-sm font-semibold text-center max-w-[90%]"
                 style={{
                   background: 'rgba(13,19,33,0.9)',
                   borderColor: ice ? MUTED : (votedCorrect ? '#7FB77E' : '#E06666'),
                   color: TEXT,
                 }}>
              {ice ? (
                <>Dead heat — no torque, so nothing rolled. Every body slid at the same a = g&nbsp;sinθ.</>
              ) : (
                <>
                  <span style={{ color: RACER_COLOR[winner] }}>
                    {shortLabel(winner, winner === 'mystery' ? mysteryId : null)}
                  </span> wins.
                  {vote && (
                    votedCorrect
                      ? <span className="text-usna-muted font-normal"> &nbsp;You called it.</span>
                      : <span className="text-usna-muted font-normal"> &nbsp;You bet on {shortLabel(vote, vote === 'mystery' ? mysteryId : null)}.</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* photo-finish strip — ordered finishers with Δt gaps */}
        {finished && !ice && finishOrder.length > 0 && (
          <PhotoFinish order={finishOrder} mysteryId={mysteryId} />
        )}

        {/* live energy partition — reservoir drain + one bar-pair per racer */}
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-usna-gold font-semibold text-sm">Energy reservoir — PE draining into K_trans + K_rot</h3>
            <span className="text-usna-muted text-xs">
              {ice ? 'sliding → 100% translational' : 'rotational share = c / (1 + c)'}
            </span>
          </div>
          <div className="flex flex-wrap gap-6">
            {activeKeys.map((k) => (
              <RacerEnergy
                key={k}
                rk={k}
                live={live[k]}
                ice={ice}
                cVal={cOf(k, mysteryId)}
                reveal={k === 'mystery' ? mysteryReveal : true}
                revealId={k === 'mystery' ? mysteryId : null}
              />
            ))}
          </div>
        </div>

        {/* readouts row */}
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4">
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            {activeKeys.map((k) => {
              const hidden = k === 'mystery' && !mysteryReveal;
              const c = cOf(k, mysteryId);
              const a = ice
                ? G * Math.sin((angle * Math.PI) / 180)
                : rollingAccel(c, angle);
              return (
                <div key={k} className="min-w-[140px]">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: RACER_COLOR[k] }} />
                    <span className="text-usna-text text-sm font-medium">
                      {shortLabel(k, k === 'mystery' && mysteryReveal ? mysteryId : null)}
                    </span>
                  </div>
                  <Readout label="c = I/mr²" value={hidden ? '?' : fmtC(c)} unit="" />
                  <Readout label="a" value={hidden ? '?' : a.toFixed(2)} unit={hidden ? '' : 'm/s²'} />
                  {live[k] && (
                    <Readout label="v" value={live[k].v.toFixed(2)} unit="m/s" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <InfoPanel {...(ice ? INFO.ice : INFO.default)} />
      </div>
    </div>
  );
}

// ── photo-finish strip: ordered finishers with time deltas ──────────────────
function PhotoFinish({ order, mysteryId }) {
  return (
    <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-usna-gold font-semibold text-sm">Photo finish</h3>
        <span className="text-usna-muted text-xs">Δt behind the leader</span>
      </div>
      {/* checkered header strip for flavor */}
      <div
        className="h-3 rounded-sm mb-3"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg,#F0ECE3 0 8px,#0D1321 8px 16px)',
          opacity: 0.5,
        }}
      />
      <div className="flex flex-col gap-1.5">
        {order.map((f, i) => {
          const col = RACER_COLOR[f.key];
          const label = shortLabel(f.key, f.key === 'mystery' ? mysteryId : null);
          return (
            <div key={f.key} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-usna-muted w-6 text-right">{i + 1}.</span>
              <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: col }} />
              <span className="flex-1 text-usna-text truncate">{label}</span>
              <span
                className="font-mono text-sm"
                style={{ color: f.delta === 0 ? '#7FB77E' : TEXT }}
              >
                {f.delta === 0 ? 'leader' : `+${f.delta.toFixed(2)} s`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── one racer's energy: reservoir drain schematic + K_trans/K_rot bars ──────
function RacerEnergy({ rk, live, ice, cVal, reveal, revealId }) {
  const col = RACER_COLOR[rk];
  const kTrans = live ? live.kTrans : 0;
  const kRot = live ? live.kRot : 0;
  const total = kTrans + kRot;
  // fixed scale reference so bars don't jump wildly at t≈0; use the running max
  const max = Math.max(total, 1);
  const rotFrac = ice ? 0 : rotationalKEFraction(cVal);
  const hidden = !reveal;
  const label = shortLabel(rk, reveal ? revealId : null);
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: col }} />
        <span className="text-usna-text text-xs font-medium">{label}</span>
      </div>
      {/* reservoir-drain schematic: PE tank up top forking into two collectors */}
      <ReservoirDrain col={col} kTrans={kTrans} kRot={kRot} rotFrac={rotFrac} ice={ice} />
      <EnergyBars
        items={[
          { label: 'K_trans', value: kTrans, color: col },
          { label: 'K_rot', value: kRot, color: hexWithAlpha(col, 0.4) },
        ]}
        max={max}
        total={total > 0 ? total : undefined}
        height={130}
        unit="J"
      />
      <div className="text-usna-muted text-xs mt-1 font-mono">
        {hidden ? 'rot ?%' : `rot ${Math.round(rotFrac * 100)}%`}
      </div>
    </div>
  );
}

/**
 * ReservoirDrain — the "starving translation" picture.
 *
 * A gravitational-PE tank sits at the top. As the body descends the tank
 * empties (its level = remaining PE), and the drained energy flows down a
 * forking channel: the left branch fills K_trans, the right branch fills K_rot.
 * The fork's split is fixed by geometry — 1/(1+c) left, c/(1+c) right — so the
 * hoop is *seen* pouring half its stream into the spin tank while the sphere
 * sends almost everything into forward motion. On ice the fork is closed off
 * (all flow goes to translation).
 */
function ReservoirDrain({ col, kTrans, kRot, rotFrac, ice }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ col, kTrans, kRot, rotFrac, ice });
  stateRef.current = { col, kTrans, kRot, rotFrac, ice };
  // simple phase clock so the flowing droplets animate
  const phaseRef = useRef(0);

  const W = 108, H = 92;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupCanvas(canvas, W, H);
    let raf = 0;
    let last = null;

    const draw = (now) => {
      let dt = last == null ? 1 / 60 : (now - last) / 1000;
      last = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      phaseRef.current = (phaseRef.current + dt) % 1;

      const { col: c, kTrans: kt, kRot: kr, rotFrac: rf, ice: onIce } = stateRef.current;
      drawReservoir(ctx, W, H, c, kt, kr, rf, onIce, phaseRef.current);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="block mb-1"
      style={{ width: W, height: H }}
      aria-hidden="true"
    />
  );
}

// Canvas painter for one racer's reservoir schematic.
function drawReservoir(ctx, W, H, col, kTrans, kRot, rotFrac, onIce, phase) {
  ctx.clearRect(0, 0, W, H);

  const total = kTrans + kRot;
  // Source-tank level is qualitative: we only know live KE, not remaining PE,
  // so we let the source drain smoothly as collected energy climbs toward a
  // running cap. The picture is honest about the FORK RATIO (which is exact and
  // set by c); the source level is illustrative of "draining as it descends."
  const cap = Math.max(total, 1);
  const collectedFrac = Math.min(1, total / cap); // →1 once moving

  // Layout: source tank (top center), two collectors (bottom left/right).
  const srcX = W / 2, srcTop = 6, srcW = 34, srcH = 22;
  const colY = H - 30, colW = 22, colH = 26;
  const leftX = 14, rightX = W - 14 - colW;

  const faint = hexWithAlpha(col, 0.28);
  const strong = hexWithAlpha(col, 0.9);

  // ── source tank outline ──
  ctx.strokeStyle = MUTED;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(srcX - srcW / 2, srcTop, srcW, srcH);
  // source fill: starts full, empties as energy is collected below
  const srcFill = Math.max(0, 1 - collectedFrac);
  ctx.fillStyle = hexWithAlpha(GOLD, 0.55);
  const fillH = srcH * srcFill;
  ctx.fillRect(srcX - srcW / 2 + 1, srcTop + (srcH - fillH) + 0, srcW - 2, Math.max(0, fillH - 1));
  ctx.fillStyle = MUTED;
  ctx.font = '8px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('PE', srcX, srcTop - 0.5);

  // ── fork channels: source → left (trans) and source → right (rot) ──
  const forkY = srcTop + srcH;
  const leftCenter = leftX + colW / 2;
  const rightCenter = rightX + colW / 2;

  // channel widths encode the split ratio (left = 1-rotFrac, right = rotFrac)
  const transFrac = 1 - rotFrac;
  const lw = 1.5 + transFrac * 6;
  const rw = onIce ? 0 : 1.5 + rotFrac * 6;

  // left channel (to K_trans)
  ctx.strokeStyle = strong;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(srcX, forkY);
  ctx.lineTo(leftCenter, colY);
  ctx.stroke();

  // right channel (to K_rot) — closed on ice
  if (!onIce) {
    ctx.strokeStyle = faint;
    ctx.lineWidth = rw;
    ctx.beginPath();
    ctx.moveTo(srcX, forkY);
    ctx.lineTo(rightCenter, colY);
    ctx.stroke();
  }

  // ── flowing droplets along each channel (animation) ──
  const flowing = total > 1e-6;
  if (flowing) {
    const drops = 3;
    for (let d = 0; d < drops; d++) {
      const p = (phase + d / drops) % 1;
      // left stream
      const lx = srcX + (leftCenter - srcX) * p;
      const ly = forkY + (colY - forkY) * p;
      ctx.fillStyle = strong;
      ctx.beginPath();
      ctx.arc(lx, ly, 1.8, 0, 2 * Math.PI);
      ctx.fill();
      // right stream (rotation) — density set by rotFrac so hoop's is busy
      if (!onIce && rotFrac > 0.05) {
        const rx = srcX + (rightCenter - srcX) * p;
        const ry = forkY + (colY - forkY) * p;
        ctx.fillStyle = faint;
        ctx.beginPath();
        ctx.arc(rx, ry, 1.6, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  // ── collector tanks ──
  const drawTank = (x, fillFrac, fillCol, tag) => {
    ctx.strokeStyle = MUTED;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, colY, colW, colH);
    const fh = colH * Math.min(1, fillFrac);
    ctx.fillStyle = fillCol;
    ctx.fillRect(x + 1, colY + (colH - fh) + 0, colW - 2, Math.max(0, fh - 1));
    ctx.fillStyle = MUTED;
    ctx.font = '7px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(tag, x + colW / 2, colY + colH + 1);
  };

  const tFrac = total > 0 ? kTrans / total : 0;
  const rFrac = total > 0 ? kRot / total : 0;
  drawTank(leftX, tFrac, strong, 'trans');
  drawTank(rightX, onIce ? 0 : rFrac, faint, 'rot');
}

// ── canvas scene: incline + racers rolling down + finish line ───────────────
function drawScene(ctx, W, H, sim, angleFallback, iceFallback, mysteryIdFallback) {
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  const theta = (sim ? sim.theta : angleFallback);
  const onIce = sim ? sim.onIce : iceFallback;
  const rad = (theta * Math.PI) / 180;

  // Ramp geometry: a right triangle. Top-left high, bottom-right low.
  const padX = 28;
  const padTop = 30;
  const padBot = 34;
  const usableW = W - padX * 2;
  const usableH = H - padTop - padBot;

  // Ramp length in pixels chosen to fit the box; racers travel [0, trackLen].
  const rampPxLen = Math.min(usableW / Math.cos(rad), usableH / Math.sin(rad) + 1);
  const startX = padX;
  const startY = padTop;
  const endX = startX + rampPxLen * Math.cos(rad);
  const endY = startY + rampPxLen * Math.sin(rad);

  // ramp surface (incline)
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // filled wedge under the ramp for depth
  ctx.fillStyle = 'rgba(197,183,131,0.06)';
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.lineTo(startX, endY);
  ctx.closePath();
  ctx.fill();

  // ground line at the foot of the ramp
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startX, endY);
  ctx.lineTo(W - padX, endY);
  ctx.stroke();

  // finish line (bottom of the ramp)
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(240,236,227,0.55)';
  ctx.lineWidth = 1.5;
  const fnX = endX, fnY = endY;
  ctx.beginPath();
  ctx.moveTo(fnX, fnY - 6);
  ctx.lineTo(fnX + 18 * Math.sin(rad), fnY - 6 - 18 * Math.cos(rad));
  ctx.stroke();
  ctx.setLineDash([]);

  // angle label
  ctx.fillStyle = MUTED;
  ctx.font = '12px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`θ = ${Math.round(theta)}°`, startX + 8, endY - 6);

  if (!sim) {
    // idle preview: hint text at the start line
    ctx.fillStyle = TEXT;
    ctx.font = '13px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Vote, then release', W / 2, padTop - 16 + usableH / 2 * 0 + 14);
    return;
  }

  const trackLen = sim.trackLen;
  // unit vectors: down-slope direction and outward normal
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const nx = Math.sin(rad), ny = -Math.cos(rad);

  // stagger racers slightly across-lanes so overlapping bodies stay readable
  const bodyR = 15;
  sim.racers.forEach((rc) => {
    const frac = Math.min(1, rc.s / trackLen);
    const along = frac * rampPxLen;
    // sit the body one radius off the surface (rolling on top of the ramp)
    const laneOff = bodyR + 2;
    const cx = startX + dx * along + nx * laneOff;
    const cy = startY + dy * along + ny * laneOff;
    const col = RACER_COLOR[rc.key];
    // the mystery racer is drawn as its hidden identity's shape but in amber,
    // so students can *see* it roll like whatever it secretly is.
    const drawKey = rc.key === 'mystery' ? sim.mystId : rc.key;
    drawBody(ctx, cx, cy, bodyR, drawKey, col, rc.s, rc.r, onIce, dx, dy, rc.key === 'mystery');
  });
}

// A rolling (or sliding) body, styled to reveal its mass distribution.
function drawBody(ctx, cx, cy, R, key, col, s, worldR, onIce, dx, dy, isMystery = false) {
  // rolling angle: φ = s / r (world). Sliding on ice → no spin.
  const phi = onIce ? 0 : (worldR > 0 ? s / worldR : 0);

  ctx.save();
  ctx.translate(cx, cy);

  // soft glow so bodies read against the dark ramp
  ctx.shadowColor = col;
  ctx.shadowBlur = 10;

  if (key === 'hoop') {
    // ring: bright rim, hollow center
    ctx.shadowBlur = 12;
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, R - 2, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (key === 'shell') {
    // hollow ball: outlined disk, thinner fill
    ctx.fillStyle = hexWithAlpha(col, 0.22);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, 2 * Math.PI);
    ctx.stroke();
  } else if (key === 'cylinder') {
    // solid disk: mid fill
    ctx.fillStyle = hexWithAlpha(col, 0.85);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    // solid sphere: full fill + highlight
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(-R * 0.32, -R * 0.32, R * 0.28, 0, 2 * Math.PI);
    ctx.fill();
  }

  // spin spoke so the eye can see it actually rolls (not on ice)
  ctx.rotate(phi);
  ctx.strokeStyle = onIce ? MUTED : '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -(R - 3));
  ctx.stroke();

  // the mystery racer wears a "?" so it reads as unknown while it rolls
  if (isMystery) {
    ctx.rotate(-phi); // un-rotate so the glyph stays upright
    ctx.fillStyle = '#0D1321';
    ctx.font = 'bold 13px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 0.5);
  }

  ctx.restore();
}

// ── tiny local helpers (kept in-file; no shared-lib edits) ──────────────────
function fmtC(c) {
  // pretty-print the classic fractions
  if (Math.abs(c - 1) < 1e-6) return '1';
  if (Math.abs(c - 0.5) < 1e-6) return '1/2';
  if (Math.abs(c - 2 / 3) < 1e-6) return '2/3';
  if (Math.abs(c - 0.4) < 1e-6) return '2/5';
  return c.toFixed(2);
}

function hexWithAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const INFO = {
  default: {
    title: 'The shape decides the winner — not the size',
    description:
      'Every rolling body accelerates at a = g sinθ / (1 + c), where c = I / m r² measures how far the mass sits from the axis. Because m and r cancel, the finishing order depends ONLY on c: the solid sphere (c = 2/5) beats the disk (1/2), which beats the hollow shell (2/3), which beats the hoop (1). Crank the mass and radius dials all you want and race again — the order never moves. The reservoir schematic shows why: gravitational PE drains through a fork whose split is fixed by c, and the hoop diverts HALF of its stream into the rotation tank (c/(1+c) = 1/2), starving the translation that carries it downhill, while the sphere pours almost everything into forward motion. The idealization has a limit, too: rolling without slipping needs friction μ_s ≥ (c/(1+c)) tanθ, so on a steep enough ramp even the hoop would begin to skid.',
    equation: String.raw`a = \frac{g\sin\theta}{1 + c}, \qquad c = \frac{I}{m r^{2}}, \qquad \frac{K_{\text{rot}}}{K_{\text{tot}}} = \frac{c}{1+c}, \qquad \mu_s \ge \frac{c}{1+c}\tan\theta`,
  },
  ice: {
    title: 'Frictionless ice — friction was the referee',
    description:
      'With no friction there is no torque about the contact point, so nothing can spin up. All the bodies simply slide, each at a = g sinθ regardless of shape, mass, or radius — a dead heat. The race only existed because friction supplied the torque that forced rotation, and rotation is what siphoned energy away from forward motion. The reservoir fork closes: with no torque the rotation tank never fills, so every joule of drained PE goes to translation. Turn friction back off and on to watch the tie collapse into a definite order.',
    equation: String.raw`\tau = 0 \;\Rightarrow\; \alpha = 0, \qquad a = g\sin\theta \quad (\text{all bodies tie})`,
  },
};
