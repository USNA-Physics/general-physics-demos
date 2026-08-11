/**
 * registry.js — Course & experiment manifest.
 *
 * Each experiment's `component` is a React.lazy() import, so Vite code-splits
 * automatically. Only the shell + chosen demo are loaded on any given page.
 *
 * SP211 is scaffolded from PLAN_211_DEMOS.md: 22 lesson demos ("D-labels")
 * serving 41 lessons via URL `?mode=` parameters. Each entry carries:
 *   - dLabel   the plan's demo id (D01 = the first lesson it serves)
 *   - due      target build date (Witt schedule)
 *   - status   'built' | 'stub'  (stub = DemoStub placeholder, awaiting build)
 *   - moment   the one counterintuitive prediction the demo is built around
 *   - modes    [{ slug, label }]  — views selected by ?mode=; first is default
 * The `lessons` array on the course encodes the Part-1 table (L1–L41 → route+mode)
 * and drives the "By lesson" index on the course page.
 *
 * To add / promote a demo: replace its stub component file, flip status to
 * 'built', and the routing + nav update automatically.
 */
import { lazy } from 'react';

const courses = [
  {
    id: 'sp211',
    title: 'SP211',
    subtitle: 'General Physics I — Mechanics',
    description: 'Kinematics, Newton\'s laws, energy, momentum, rotation, oscillations, and waves.',
    // Curated chapter subsets — appear as filter pills (URL: /#/sp211?group=…).
    groups: [
      { slug: 'unit1', label: 'Unit I · Kinematics & Newton', description: 'L1–L13: 1D/2D motion, projectiles, circular motion, Newton\'s laws, friction, drag.', chapterSlugs: ['ch02-motion-1d', 'ch03-motion-2d', 'ch04-newton', 'ch05-applications'] },
      { slug: 'unit2', label: 'Unit II · Energy & Momentum', description: 'L14–L23: center of mass, work, power, energy landscapes, collisions.', chapterSlugs: ['ch05-applications', 'ch06-work', 'ch07-energy', 'ch08-momentum'] },
      { slug: 'unit3', label: 'Unit III · Rotation, Gravity & Fluids', description: 'L24–L34: rotational dynamics, rolling, angular momentum, orbits, buoyancy.', chapterSlugs: ['ch09-rotation', 'ch10-angular-momentum', 'ch11-gravity', 'ch13-fluids'] },
      { slug: 'unit4', label: 'Unit IV · Oscillations & Waves', description: 'L35–L41: SHM, traveling waves, Doppler, superposition, standing waves.', chapterSlugs: ['ch14-oscillations', 'ch15-waves', 'ch16-superposition'] },
    ],
    chapters: [
      {
        slug: 'ch02-motion-1d',
        number: 2,
        title: 'Motion in One Dimension',
        experiments: [
          {
            slug: 'free-fall',
            dLabel: 'D02',
            title: 'Free Fall Explorer',
            description: 'A ball drops from adjustable height; position and velocity trace against the constant-acceleration predictions. Hosts projectile (D06) and drag (D12) as modes.',
            moment: 'Predict the fall time from the height, then watch x(t) trace the parabola your equation predicted.',
            status: 'built',
            modes: [
              { slug: 'default', label: 'Free fall (L2)' },
              { slug: 'projectile', label: 'Projectile · D06 (L6)' },
              { slug: 'drag', label: 'Drag · D12 (L12)' },
            ],
            component: lazy(() => import('./courses/sp211/ch02-motion-1d/FreeFall')),
          },
          {
            slug: 'grapher',
            dLabel: 'D01',
            title: '1D Motion Grapher',
            description: 'Three time-synchronized plots — x(t), v(t), a(t). The student drives the motion by dragging a cart or picking a preset; the graphs respond live.',
            moment: 'Move the cart backward and v goes negative while x is still positive — negative velocity is not decreasing position.',
            due: 'Aug 17',
            status: 'built',
            modes: [
              { slug: 'default', label: 'Motion (L1)' },
              { slug: 'area', label: 'Area = integral (L3)' },
              { slug: 'force', label: 'Force → a (L8)' },
            ],
            component: lazy(() => import('./courses/sp211/ch02-motion-1d/Grapher')),
          },
        ],
      },
      {
        slug: 'ch03-motion-2d',
        number: 3,
        title: 'Motion in Two Dimensions',
        experiments: [
          {
            slug: 'vectors',
            dLabel: 'D04',
            title: '2D Vector Kinematics Sandbox',
            description: 'Place and drag waypoints to define a path; a particle animates along it showing the velocity vector (tangent) and acceleration vector (toward the inside of curves).',
            moment: 'On a curve at constant speed, the acceleration vector is visibly nonzero and points sideways — priming centripetal three lessons early.',
            due: 'Aug 18',
            status: 'built',
            component: lazy(() => import('./courses/sp211/ch03-motion-2d/VectorKinematics')),
          },
          {
            slug: 'relative',
            dLabel: 'D05',
            title: 'Relative Motion (Riverboat)',
            description: 'A boat crosses a current; set heading, boat speed, and current, and watch heading + current + ground track compose tip-to-tail. Frame toggle swaps water vs. ground frame.',
            moment: 'Aim straight across, land downstream — then flip the frame and the same motion looks completely different.',
            due: 'Aug 19',
            status: 'built',
            component: lazy(() => import('./courses/sp211/ch03-motion-2d/RelativeMotion')),
          },
          {
            slug: 'ucm',
            dLabel: 'D07',
            title: 'UCM Vector Visualizer',
            description: 'A particle on a circle with its tangent-velocity and inward-acceleration vectors. Banked mode decomposes N, mg, and friction on a banked track.',
            moment: 'Pause and ask which way the acceleration points — most say "forward." It points inward, always.',
            due: 'Aug 21',
            status: 'built',
            modes: [
              { slug: 'kinematic', label: 'Kinematic (L7)' },
              { slug: 'banked', label: 'Banked curve (L13)' },
            ],
            component: lazy(() => import('./courses/sp211/ch03-motion-2d/UcmVisualizer')),
          },
        ],
      },
      {
        slug: 'ch04-newton',
        number: 4,
        title: 'Newton\'s Laws',
        experiments: [
          {
            slug: 'fbd',
            dLabel: 'D09',
            title: 'Free-Body Diagram Builder',
            description: 'Drag force vectors onto bodies from a palette; a net-force readout and a "check" flag missing/misdirected forces with physics feedback. Pairs mode highlights Newton\'s-third-law partners.',
            moment: 'The horse-and-cart paradox: pairs highlighting shows action and reaction act on different bodies and never cancel.',
            due: 'Sep 1',
            status: 'built',
            modes: [
              { slug: 'fbd', label: 'Build FBD (L9)' },
              { slug: 'pairs', label: '3rd-law pairs (L10)' },
            ],
            component: lazy(() => import('./courses/sp211/ch04-newton/FbdBuilder')),
          },
        ],
      },
      {
        slug: 'ch05-applications',
        number: 5,
        title: 'Applications of Newton\'s Laws',
        experiments: [
          {
            slug: 'friction',
            dLabel: 'D11',
            title: 'Friction Incline',
            description: 'A block on a tiltable incline sticks, then breaks away. Force-balance readout shows static friction climbing to its ceiling, then dropping discontinuously at breakaway.',
            moment: 'Breakaway happens at tan θ = μ_s independent of mass — change the mass and the angle does not move.',
            due: 'Aug 27',
            status: 'built',
            component: lazy(() => import('./courses/sp211/ch05-applications/FrictionIncline')),
          },
          {
            slug: 'cm',
            dLabel: 'D14',
            title: 'Center of Mass Playground',
            description: 'Place point masses and watch the CM move live. Tumbling mode launches an extended object as a projectile — the body tumbles while the CM traces a clean parabola.',
            moment: 'Toggle the CM trail on a tumbling wrench: the chaos resolves into a single clean parabola.',
            due: 'Aug 31',
            status: 'built',
            modes: [
              { slug: 'default', label: 'CM finder (L14)' },
              { slug: 'tumbling', label: 'Tumbling (L14)' },
            ],
            component: lazy(() => import('./courses/sp211/ch05-applications/CenterOfMass')),
          },
        ],
      },
      {
        slug: 'ch06-work',
        number: 6,
        title: 'Work and Energy',
        experiments: [
          {
            slug: 'work',
            dLabel: 'D15',
            title: 'Work & Power Visualizer',
            description: 'A crate dragged by a rope; the angle slider decomposes the force into working and useless components. Area mode accumulates work under F(x); power mode races equal-power efforts.',
            moment: 'At 90° the work goes to zero while the force is still large — effort without work.',
            due: 'Sep 9',
            status: 'built',
            modes: [
              { slug: 'dot', label: 'W = F·d cos θ (L15)' },
              { slug: 'area', label: 'Area under F(x) (L16)' },
              { slug: 'power', label: 'Power (L17)' },
            ],
            component: lazy(() => import('./courses/sp211/ch06-work/WorkPower')),
          },
        ],
      },
      {
        slug: 'ch07-energy',
        number: 7,
        title: 'Potential Energy & Conservation',
        experiments: [
          {
            slug: 'landscape',
            dLabel: 'D18',
            title: 'Energy Landscape Explorer',
            description: 'A ball rolls on a student-shaped U(x); K and U bars exchange while the total-E line holds flat. Equilibria mode marks stable/unstable points; dissipation mode adds a thermal column.',
            moment: 'Balance the ball on the double-well hump — it sits until the slightest nudge decides which well it falls into.',
            due: 'Sep 18',
            status: 'built',
            modes: [
              { slug: 'default', label: 'K ↔ U trade (L18)' },
              { slug: 'equilibria', label: 'Equilibria (L19)' },
              { slug: 'dissipation', label: 'Dissipation (L20)' },
            ],
            component: lazy(() => import('./courses/sp211/ch07-energy/EnergyLandscape')),
          },
        ],
      },
      {
        slug: 'ch08-momentum',
        number: 8,
        title: 'Linear Momentum',
        experiments: [
          {
            slug: 'collisions',
            dLabel: 'D22',
            title: 'Collision Sandbox',
            description: 'Two carts collide; momentum and KE bar charts sit side by side while an elasticity slider runs from perfectly elastic to inelastic. Impulse mode plots F(t); 2D mode conserves components.',
            moment: 'Drag the elasticity slider: KE loss grows while the total-momentum bar never flinches.',
            due: 'Sep 21',
            status: 'built',
            modes: [
              { slug: '1d', label: '1D carts (L21)' },
              { slug: 'impulse', label: 'Impulse F(t) (L22)' },
              { slug: '2d', label: '2D glancing (L23)' },
            ],
            component: lazy(() => import('./courses/sp211/ch08-momentum/CollisionSandbox')),
          },
        ],
      },
      {
        slug: 'ch09-rotation',
        number: 9,
        title: 'Rotation',
        experiments: [
          {
            slug: 'grapher',
            dLabel: 'D24',
            title: 'Rotational Kinematics Grapher',
            description: 'D01\'s angular twin — θ(t), ω(t), α(t) stacked and linked, driven by a spinning disk. A rim dot connects v = rω; a dot at half the radius moves at half the speed.',
            moment: 'Everything from week 1 happens again with Greek letters — run this beside D01 and watch the isomorphism land.',
            due: 'Oct 7',
            status: 'built',
            component: lazy(() => import('./courses/sp211/ch09-rotation/RotationGrapher')),
          },
          {
            slug: 'inertia',
            dLabel: 'D25',
            title: 'Moment of Inertia Explorer',
            description: 'A gallery of bodies with mass distribution shaded; spin each with the same flick and compare. Torque mode draws the lever arm; dynamics mode runs Στ = Iα across shapes.',
            moment: 'Hoop vs. disk, same mass and radius, same flick — the hoop responds sluggishly because of where the mass sits.',
            due: 'Oct 8',
            status: 'built',
            modes: [
              { slug: 'shapes', label: 'Shapes & I (L25)' },
              { slug: 'torque', label: 'Torque (L26)' },
              { slug: 'dynamics', label: 'Στ = Iα (L27)' },
            ],
            component: lazy(() => import('./courses/sp211/ch09-rotation/MomentOfInertia')),
          },
          {
            slug: 'rolling',
            dLabel: 'D28',
            title: 'Rolling Race',
            description: 'Hoop, disk, and sphere released together down an incline; students vote first. Energy-partition bars split KE into translational and rotational shares live.',
            moment: 'The sphere wins regardless of mass and radius — the order depends only on I/mr², and the bars show why.',
            due: 'Oct 9',
            status: 'built',
            component: lazy(() => import('./courses/sp211/ch09-rotation/RollingRace')),
          },
        ],
      },
      {
        slug: 'ch10-angular-momentum',
        number: 10,
        title: 'Angular Momentum',
        experiments: [
          {
            slug: 'conservation',
            dLabel: 'D30',
            title: 'Angular Momentum Conservation',
            description: 'Vector mode makes L = r × p visible for straight-line motion past a pivot. Skater mode drops I with an arm slider — ω rises, L holds, and KE rises.',
            moment: 'Pull the skater\'s arms in: L stays put but KE rises — where did the energy come from?',
            due: 'Oct 12',
            status: 'built',
            modes: [
              { slug: 'vector', label: 'L = r × p (L29)' },
              { slug: 'skater', label: 'Skater (L30)' },
            ],
            component: lazy(() => import('./courses/sp211/ch10-angular-momentum/AngularMomentum')),
          },
        ],
      },
      {
        slug: 'ch11-gravity',
        number: 11,
        title: 'Gravity',
        experiments: [
          {
            slug: 'orbits',
            dLabel: 'D31',
            title: 'Orbit Simulator',
            description: 'A satellite launched tangentially; the launch-speed slider sweeps suborbital → circular → ellipse → escape. Kepler mode animates equal areas; escape mode watches the energy sign flip.',
            moment: 'An orbit is just a projectile that keeps missing the ground — increase the speed until the arc closes.',
            due: 'Oct 13',
            status: 'built',
            modes: [
              { slug: 'kepler', label: 'Kepler\'s laws (L31)' },
              { slug: 'escape', label: 'Escape (L32)' },
            ],
            component: lazy(() => import('./courses/sp211/ch11-gravity/OrbitSimulator')),
          },
        ],
      },
      {
        slug: 'ch13-fluids',
        number: 13,
        title: 'Fluids',
        experiments: [
          {
            slug: 'tank',
            dLabel: 'D34',
            title: 'Buoyancy Tank',
            description: 'Pressure mode drags a depth probe through P = P₀ + ρgh with pressure arrows from all directions. Buoyancy mode lowers an object of adjustable density: sink, float, or hover.',
            moment: 'The iceberg preset shows ~90% submerged; the submarine preset makes buoyancy a career topic, not a chapter.',
            due: 'Oct 14',
            status: 'built',
            modes: [
              { slug: 'pressure', label: 'Pressure (L33)' },
              { slug: 'buoyancy', label: 'Buoyancy (L34)' },
            ],
            component: lazy(() => import('./courses/sp211/ch13-fluids/BuoyancyTank')),
          },
        ],
      },
      {
        slug: 'ch14-oscillations',
        number: 14,
        title: 'Oscillations',
        experiments: [
          {
            slug: 'shm',
            dLabel: 'D35',
            title: 'SHM Explorer',
            description: 'Mass-on-spring with x(t) tracing live; k and m change the period but amplitude does not. Pendulum mode integrates the full sin θ equation and measures where small-angle fails.',
            moment: 'Amplitude does not change the period — most predict bigger swings take longer; the readout says no.',
            due: 'Oct 26',
            status: 'built',
            modes: [
              { slug: 'spring', label: 'Mass-spring (L35)' },
              { slug: 'pendulum', label: 'Pendulum (L36)' },
            ],
            component: lazy(() => import('./courses/sp211/ch14-oscillations/ShmExplorer')),
          },
        ],
      },
      {
        slug: 'ch15-waves',
        number: 15,
        title: 'Traveling Waves',
        experiments: [
          {
            slug: 'traveling',
            dLabel: 'D37',
            title: 'Traveling Wave Explorer',
            description: 'y(x,t) = A sin(kx − ωt) on a string, with marked particles that bob in place while the waveform sails by. Longitudinal mode shows compressions and the displacement/pressure 90° offset.',
            moment: 'Click a particle: it moves only up-down while the wave moves left-right — what travels is the pattern, not the stuff.',
            due: 'Oct 27',
            status: 'built',
            modes: [
              { slug: 'transverse', label: 'Transverse (L37)' },
              { slug: 'longitudinal', label: 'Longitudinal (L38)' },
            ],
            component: lazy(() => import('./courses/sp211/ch15-waves/TravelingWave')),
          },
          {
            slug: 'doppler',
            dLabel: 'D39',
            title: 'Doppler Wavefront Visualizer',
            description: 'A moving source emits circular wavefronts that crowd ahead and stretch behind; a draggable observer shows received frequency. Past Mach 1 the wavefronts pile into a Mach cone.',
            moment: 'Slide the source speed to v and the wavefronts pile into a wall — the sound barrier, then the Mach cone opens.',
            due: 'Oct 28',
            status: 'built',
            component: lazy(() => import('./courses/sp211/ch15-waves/DopplerWavefront')),
          },
        ],
      },
      {
        slug: 'ch16-superposition',
        number: 16,
        title: 'Superposition & Standing Waves',
        experiments: [
          {
            slug: 'sandbox',
            dLabel: 'D40',
            title: 'Superposition Sandbox',
            description: 'Two wave engines summed; detune them and a beat envelope emerges with audio. Standing mode adds counter-propagating waves with nodes that stay put and harmonic presets.',
            moment: 'Freeze the standing wave the instant the string is flat — where did the energy go? (All kinetic, that instant.)',
            due: 'Oct 29',
            status: 'built',
            modes: [
              { slug: 'beats', label: 'Beats (L40)' },
              { slug: 'standing', label: 'Standing waves (L41)' },
            ],
            component: lazy(() => import('./courses/sp211/ch16-superposition/SuperpositionSandbox')),
          },
        ],
      },
    ],
    // Part-1 lesson map: L1–L41 → the exact route + mode each lesson links.
    // Drives the "By lesson" index.
    lessons: [
      { n: 1, topic: '1D displacement, velocity', chapter: 'ch02-motion-1d', experiment: 'grapher', mode: 'default', dLabel: 'D01' },
      { n: 2, topic: 'Constant acceleration', chapter: 'ch02-motion-1d', experiment: 'free-fall', mode: 'default', dLabel: 'D02' },
      { n: 3, topic: 'Integration, kinematics', chapter: 'ch02-motion-1d', experiment: 'grapher', mode: 'area', dLabel: 'D01' },
      { n: 4, topic: '2D kinematics', chapter: 'ch03-motion-2d', experiment: 'vectors', mode: 'default', dLabel: 'D04' },
      { n: 5, topic: 'Relative motion', chapter: 'ch03-motion-2d', experiment: 'relative', mode: 'default', dLabel: 'D05' },
      { n: 6, topic: 'Projectile motion', chapter: 'ch02-motion-1d', experiment: 'free-fall', mode: 'projectile', dLabel: 'D06' },
      { n: 7, topic: 'Circular motion', chapter: 'ch03-motion-2d', experiment: 'ucm', mode: 'kinematic', dLabel: 'D07' },
      { n: 8, topic: 'Newton\'s 1st / 2nd', chapter: 'ch02-motion-1d', experiment: 'grapher', mode: 'force', dLabel: 'D01' },
      { n: 9, topic: 'Contact forces, FBDs', chapter: 'ch04-newton', experiment: 'fbd', mode: 'fbd', dLabel: 'D09' },
      { n: 10, topic: 'Newton\'s 3rd', chapter: 'ch04-newton', experiment: 'fbd', mode: 'pairs', dLabel: 'D09' },
      { n: 11, topic: 'Friction', chapter: 'ch05-applications', experiment: 'friction', mode: 'default', dLabel: 'D11' },
      { n: 12, topic: 'Drag', chapter: 'ch02-motion-1d', experiment: 'free-fall', mode: 'drag', dLabel: 'D12' },
      { n: 13, topic: 'Curved paths, UCM dynamics', chapter: 'ch03-motion-2d', experiment: 'ucm', mode: 'banked', dLabel: 'D07' },
      { n: 14, topic: 'Center of mass', chapter: 'ch05-applications', experiment: 'cm', mode: 'default', dLabel: 'D14' },
      { n: 15, topic: 'Work, constant forces', chapter: 'ch06-work', experiment: 'work', mode: 'dot', dLabel: 'D15' },
      { n: 16, topic: 'Work, variable forces', chapter: 'ch06-work', experiment: 'work', mode: 'area', dLabel: 'D15' },
      { n: 17, topic: 'Power, curved paths', chapter: 'ch06-work', experiment: 'work', mode: 'power', dLabel: 'D15' },
      { n: 18, topic: 'Potential energy', chapter: 'ch07-energy', experiment: 'landscape', mode: 'default', dLabel: 'D18' },
      { n: 19, topic: 'Mech. energy, equilibrium', chapter: 'ch07-energy', experiment: 'landscape', mode: 'equilibria', dLabel: 'D18' },
      { n: 20, topic: 'Conservation of total energy', chapter: 'ch07-energy', experiment: 'landscape', mode: 'dissipation', dLabel: 'D18' },
      { n: 21, topic: 'Linear momentum', chapter: 'ch08-momentum', experiment: 'collisions', mode: '1d', dLabel: 'D22' },
      { n: 22, topic: 'Impulse, 1D collisions', chapter: 'ch08-momentum', experiment: 'collisions', mode: 'impulse', dLabel: 'D22' },
      { n: 23, topic: '2D collisions', chapter: 'ch08-momentum', experiment: 'collisions', mode: '2d', dLabel: 'D22' },
      { n: 24, topic: 'Rotational kinematics', chapter: 'ch09-rotation', experiment: 'grapher', mode: 'default', dLabel: 'D24' },
      { n: 25, topic: 'Rotational KE, moment of inertia', chapter: 'ch09-rotation', experiment: 'inertia', mode: 'shapes', dLabel: 'D25' },
      { n: 26, topic: 'Torque, N2 rotation (I)', chapter: 'ch09-rotation', experiment: 'inertia', mode: 'torque', dLabel: 'D25' },
      { n: 27, topic: 'N2 rotation (II), power', chapter: 'ch09-rotation', experiment: 'inertia', mode: 'dynamics', dLabel: 'D25' },
      { n: 28, topic: 'Rolling', chapter: 'ch09-rotation', experiment: 'rolling', mode: 'default', dLabel: 'D28' },
      { n: 29, topic: 'Angular momentum', chapter: 'ch10-angular-momentum', experiment: 'conservation', mode: 'vector', dLabel: 'D30' },
      { n: 30, topic: 'Conservation of ang. momentum', chapter: 'ch10-angular-momentum', experiment: 'conservation', mode: 'skater', dLabel: 'D30' },
      { n: 31, topic: 'Kepler\'s laws', chapter: 'ch11-gravity', experiment: 'orbits', mode: 'kepler', dLabel: 'D31' },
      { n: 32, topic: 'Grav. PE, orbits, escape', chapter: 'ch11-gravity', experiment: 'orbits', mode: 'escape', dLabel: 'D31' },
      { n: 33, topic: 'Fluids, pressure', chapter: 'ch13-fluids', experiment: 'tank', mode: 'pressure', dLabel: 'D34' },
      { n: 34, topic: 'Buoyancy', chapter: 'ch13-fluids', experiment: 'tank', mode: 'buoyancy', dLabel: 'D34' },
      { n: 35, topic: 'SHM', chapter: 'ch14-oscillations', experiment: 'shm', mode: 'spring', dLabel: 'D35' },
      { n: 36, topic: 'Oscillating systems', chapter: 'ch14-oscillations', experiment: 'shm', mode: 'pendulum', dLabel: 'D35' },
      { n: 37, topic: 'Traveling waves', chapter: 'ch15-waves', experiment: 'traveling', mode: 'transverse', dLabel: 'D37' },
      { n: 38, topic: 'Sound, intensity', chapter: 'ch15-waves', experiment: 'traveling', mode: 'longitudinal', dLabel: 'D37' },
      { n: 39, topic: 'Doppler', chapter: 'ch15-waves', experiment: 'doppler', mode: 'default', dLabel: 'D39' },
      { n: 40, topic: 'Superposition, beats', chapter: 'ch16-superposition', experiment: 'sandbox', mode: 'beats', dLabel: 'D40' },
      { n: 41, topic: 'Standing waves', chapter: 'ch16-superposition', experiment: 'sandbox', mode: 'standing', dLabel: 'D40' },
    ],
  },
  {
    id: 'sp212',
    title: 'SP212',
    subtitle: 'General Physics II — Electricity & Magnetism',
    description: 'Electric fields, circuits, magnetism, optics, and modern physics.',
    chapters: [
      {
        slug: 'ch33-diffraction',
        number: 33,
        title: 'Interference and Diffraction',
        experiments: [
          {
            slug: 'single-slit',
            title: 'Single-Slit Diffraction',
            description: 'Fraunhofer diffraction pattern from a single slit — intensity profile, screen strip, and minima annotations.',
            component: lazy(() => import('./courses/sp212/ch33-diffraction/SingleSlit')),
          },
          {
            slug: 'circular-aperture',
            title: 'Circular Aperture (Airy Pattern)',
            description: 'Diffraction through a circular aperture — radial intensity profile and 2D Airy disk visualization.',
            component: lazy(() => import('./courses/sp212/ch33-diffraction/CircularAperture')),
          },
          {
            slug: 'rayleigh',
            title: 'Rayleigh Criterion',
            description: 'Two-source resolution limit — overlapping Airy patterns with resolved/unresolved status indicator.',
            component: lazy(() => import('./courses/sp212/ch33-diffraction/Rayleigh')),
          },
          {
            slug: 'comparison',
            title: 'Double vs. Single Slit',
            description: 'Side-by-side interference, envelope, and combined patterns with missing order annotations.',
            component: lazy(() => import('./courses/sp212/ch33-diffraction/Comparison')),
          },
          {
            slug: 'sandbox',
            title: 'N-Slit Sandbox',
            description: 'Explore the evolution from single slit (N=1) through double slit to diffraction grating (N=20).',
            component: lazy(() => import('./courses/sp212/ch33-diffraction/Sandbox')),
          },
          {
            slug: 'phasors',
            title: 'Phasor Diagrams',
            description: 'Dynamic vector addition diagrams showing how phasors determine intensity for single-slit and N-slit patterns.',
            component: lazy(() => import('./courses/sp212/ch33-diffraction/Phasors')),
          },
        ],
      },
    ],
  },
];

export default courses;

/**
 * Lookup helpers used by the shell routing components.
 */
export function findCourse(courseId) {
  return courses.find((c) => c.id === courseId);
}

export function findChapter(courseId, chapterSlug) {
  const course = findCourse(courseId);
  return course?.chapters.find((ch) => ch.slug === chapterSlug);
}

export function findExperiment(courseId, chapterSlug, experimentSlug) {
  const chapter = findChapter(courseId, chapterSlug);
  return chapter?.experiments.find((e) => e.slug === experimentSlug);
}
