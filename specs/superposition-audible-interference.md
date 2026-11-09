# Spec — Audible Interference: Two Real Tones in the Superposition Sandbox

- **Status:** Built · **Requested:** 2026-11-09 · Jim · enhancement to `SuperpositionSandbox.jsx` beats mode (two-oscillator honest sum + relative-phase control). Sliders are real audio Hz; the canvas runs as a slowed, detune-exaggerated caricature so the waveform stays watchable while the audio plays true tones.
- **Target:** course `sp211` / chapter `ch16-superposition` / slug `sandbox`, **beats mode** · **dLabel D40**
  (an **audio enhancement** to the existing Built widget `SuperpositionSandbox.jsx`)
- **Route:** `/#/sp211/ch16-superposition/sandbox?mode=beats`
- **Serves:** **SP211 L40 (Superposition, Interference, Beats)** — specifically, it makes the lesson's
  "predict what you hear" primer *actually hearable*: two speakers reinforcing, two speakers cancelling to
  silence, a slow beat throb, and a wide gap heard as two separate pitches.

## Why (the gap this closes)

The beats mode today renders sound with a **single oscillator at the average frequency** `½(f₁+f₂)` whose
**gain** is modulated at the beat rate (`SuperpositionSandbox.jsx`, ~line 157). That faithfully reproduces the
**throb** but misrepresents the others:

- **Wide gap (e.g. 400 + 600 Hz):** amplitude-modulating a 500 Hz carrier at 200 Hz makes sidebands at **300
  and 700 Hz**, not the real 400 and 600 — so it cannot deliver "two separate pitches."
- **Destructive case (½λ path / antiphase):** there is no relative-phase control summing two real sources, so
  two tones adding to **silence** cannot be heard.

The fix is to synthesize the sum **honestly**: two real oscillators summed at the output, with a relative
phase/path control. The visual half of the widget is already correct and stays as-is.

## Purpose + Moment

Let a class *predict* what two steady tones do, then **hear the real answer**: reinforcement, cancellation to
silence, a throb, or a chord — straight from summing two sine waves.

> **Moment:** two speakers blaring the same note can add up to **silence**; two close notes **throb**; two
> distant notes are just **two notes**. Same operation every time — the air displacements add — but what you
> hear flips from louder, to silent, to a beat, to a chord as you slide the frequencies and the phase.

## Learning goals

- **Superposition is heard, not just drawn:** the output is literally $y_1+y_2$, so equal-and-opposite
  displacements cancel (destructive) and aligned ones reinforce (constructive).
- **Same frequency → a pattern set by phase/path:** with $f_1=f_2$, sliding the relative phase $\delta$ (or the
  path difference $\Delta x$) runs the loudness from $2A$ (in step) to $0$ (antiphase).
- **Close frequencies → beats:** a small detune gives an audible throb at $f_{\text{beat}}=|f_1-f_2|$.
- **Wide gap → two pitches, not a throb:** the beat "rate" outruns the ear and the two tones separate — beats
  are the small-gap limit.

## Visual design

No change to the existing canvas: the two component waves, their sum (bold navy), and the beat envelope (gold)
stay. The only additions are (a) a **relative-phase / path slider** that also drives the same-frequency sum
curve from double-height to flat, and (b) a small **"what you'd hear" caption** that updates with the sliders
(e.g. *louder · silent · throb 3/s · two tones*). Palette unchanged (navy sum, gold envelope/answer, gray axes).

## Interactions & modes

Within the existing **beats** mode, the controls become:

- **f₁, f₂** sliders (already present) — set equal for interference (a,b), close for beats (c), far apart for
  the chord (d).
- **Relative phase δ** slider, labeled both in radians and as a **path difference** $\Delta x/\lambda$ from $0$
  to $1$ (so $\tfrac12\lambda \Rightarrow \delta=\pi \Rightarrow$ cancellation). Active/meaningful when
  $f_1=f_2$; for unequal frequencies the phase drifts on its own and the slider is shown disabled with a note.
- **Play/Pause audio** (existing) and **Volume** (existing).
- **Quick presets** matching the primer: *(a) equal, in step · (b) equal, ½λ apart · (c) 400 \& 403 · (d) 400 \& 600*.

## Audio engine (the actual change)

Replace the single-oscillator + gain-AM synthesis with a **true two-oscillator sum**:

- Two `OscillatorNode`s (`sine`) at `audioHz(f₁)` and `audioHz(f₂)`, each → its own `GainNode` → a shared
  master `GainNode` → `destination`. The beat/interference envelope then **emerges** from the real sum; the
  rAF loop no longer needs to fake it.
- **Relative phase** for the $f_1=f_2$ case: oscillators expose no phase parameter, so impose $\delta$ with a
  `DelayNode` of $\delta/\omega$ seconds (equivalently a scheduled start offset) on one branch. Exact for a
  single frequency, which is all the destructive-interference case needs. (For $f_1\ne f_2$ the relative phase
  is time-dependent and the delay is simply left at zero.)
- **Soft ramps** on the master gain at start/stop and on every slider change (`setTargetAtTime`, ~20 ms) to
  avoid clicks; keep everything inside the existing user-gesture start (mobile autoplay policy).
- Keep `audioHz(...)` mapping (lesson frequencies are shifted into a comfortable listening band); apply the
  **same** shift to both oscillators so the ratio — and thus the musical interval and the beat rate — is
  preserved.

## Math shown (KaTeX)

- Superposition: $y = y_1 + y_2$.
- Same frequency: $y_1+y_2 = \big[2A\cos\tfrac12\delta\big]\sin(kx-\omega t+\tfrac12\delta)$, with
  $\delta = 2\pi\,\Delta x/\lambda$; constructive $\delta=0$, destructive $\delta=\pi$.
- Beats: $f_{\text{beat}} = |f_1-f_2|$, $T_{\text{beat}} = 1/f_{\text{beat}}$.

## Acceptance criteria

- **(a) equal, in step:** audibly louder than one source; sum curve at $2A$.
- **(b) equal, ½λ apart ($\delta=\pi$):** output drops to **silence** (master level near zero); sum curve flat.
- **(c) 400 & 403:** a clear **throb** at $\approx 3$ per second; envelope breathes at $|f_1-f_2|$.
- **(d) 400 & 600:** two **distinct pitches** (a perfect fifth), with **no** spurious 300/700 Hz sidebands —
  i.e. real oscillators, not AM of the average.
- Sliders are click-free; audio starts only on a user gesture; the "what you'd hear" caption matches the sound.
- No regression to the visual sum/envelope or to the standing-waves mode of the same widget.

## Technical notes

- All changes are local to `SuperpositionSandbox.jsx`'s beats-mode audio path (`startAudio`/`stopAudio` and the
  frequency-update effects). Two `OscillatorNode`s + per-branch `GainNode` + optional `DelayNode` + master
  `GainNode`; tear everything down on unmount/mode-switch (as the current code already does for `osc1`).
- The phase `DelayNode` only needs to be correct for the equal-frequency case; clamp $\delta\in[0,2\pi)$ and
  recompute the delay on `f`/`δ` change.
- Keep CPU trivial (two oscillators); no AudioWorklet needed.

## Out of scope / future

- Stereo/spatialized two-speaker placement (a `PannerNode` "walk the room" experience) — a later enhancement;
  this spec is the minimal honest-sum fix. Microphone input / tuning to zero-beat; non-sine timbres; the
  standing-waves mode's audio (unchanged here).
