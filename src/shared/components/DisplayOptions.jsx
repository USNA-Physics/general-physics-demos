import { useState } from 'react';
import InfoModal, { InfoIcon } from './InfoModal';

/**
 * Display options panel: lock x-axis, log y-scale, brightness (gamma).
 * Each option has an info icon that opens a plain-English explanation.
 */
export default function DisplayOptions({
  lockAxis, onLockAxisChange,
  logScale, onLogScaleChange,
  gamma, onGammaChange,
}) {
  const [modal, setModal] = useState(null);

  return (
    <div className="mt-5 pt-4 border-t border-usna-grid">
      <h3 className="text-usna-muted text-xs font-semibold uppercase tracking-wider mb-3">
        Display
      </h3>

      {onLockAxisChange && (
        <div className="flex items-center gap-2 mb-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-usna-text">
            <input
              type="checkbox"
              checked={lockAxis}
              onChange={(e) => onLockAxisChange(e.target.checked)}
              className="accent-usna-gold w-4 h-4"
            />
            Lock x-axis range
          </label>
          <InfoIcon onClick={() => setModal('lockAxis')} />
        </div>
      )}

      {onLogScaleChange && (
        <div className="flex items-center gap-2 mb-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-usna-text">
            <input
              type="checkbox"
              checked={logScale}
              onChange={(e) => onLogScaleChange(e.target.checked)}
              className="accent-usna-gold w-4 h-4"
            />
            Log intensity scale
          </label>
          <InfoIcon onClick={() => setModal('logScale')} />
        </div>
      )}

      {onGammaChange && (
        <div className="mb-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="flex justify-between items-baseline flex-1">
              <span className="text-usna-text text-sm">Brightness boost</span>
              <span className="font-mono text-sm text-usna-gold tabular-nums">
                {gamma.toFixed(2)}
              </span>
            </div>
            <InfoIcon onClick={() => setModal('gamma')} />
          </div>
          <input
            type="range"
            min={0.1}
            max={1.0}
            step={0.05}
            value={gamma}
            onInput={(e) => onGammaChange(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
      )}

      {/* Info Modals */}
      <InfoModal
        open={modal === 'lockAxis'}
        onClose={() => setModal(null)}
        title="Lock X-Axis Range"
      >
        <p>
          When checked, the horizontal axis stays fixed as you adjust parameters.
          This lets you <strong>see the pattern physically spread out or compress</strong> as
          you change the slit width or wavelength.
        </p>
        <p>
          When unchecked, the plot auto-scales to always show the same number of
          peaks, which can make it look like nothing is changing.
        </p>
      </InfoModal>

      <InfoModal
        open={modal === 'logScale'}
        onClose={() => setModal(null)}
        title="Log Intensity Scale"
      >
        <p>
          Switches the vertical axis to a <strong>logarithmic scale</strong> (powers of 10).
          The secondary maxima in a diffraction pattern are much dimmer than the
          central peak — often 100 to 10,000 times fainter.
        </p>
        <p>
          On a linear scale these faint features are invisible, but on a log scale
          you can see their structure clearly. This is how experimental physicists
          typically view diffraction data.
        </p>
      </InfoModal>

      <InfoModal
        open={modal === 'gamma'}
        onClose={() => setModal(null)}
        title="Brightness Boost"
      >
        <p>
          Controls how the colored image strips and 2D disk renders map intensity
          to brightness. At <strong>1.0</strong> the mapping is physically accurate —
          but the secondary maxima are too faint to see.
        </p>
        <p>
          Lowering this value <strong>boosts faint features</strong> so you can see
          the ring structure and secondary fringes in the colored images.
          Think of it like adjusting the exposure on a camera.
        </p>
      </InfoModal>
    </div>
  );
}
