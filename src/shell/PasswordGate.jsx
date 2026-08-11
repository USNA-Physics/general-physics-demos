import { useState } from 'react';

/**
 * PasswordGate — a lightweight client-side "keep the lookyloos out" screen.
 *
 * NOT real security: GitHub Pages is static hosting with no server, so anything
 * shipped to the browser (JS, media) is ultimately reachable by a determined
 * visitor. This only hides the app UI behind a shared class password so casual
 * passers-by don't wander in. We store the SHA-256 of the password (never the
 * plaintext) and compare hashes; once entered, an unlock flag is remembered in
 * localStorage so students don't retype it every visit.
 */

// SHA-256 of the class password.
const PW_SHA256 = 'c0e3c8482669b1e5d1769c69ca3a436f785adac3ce2d099c35da0c1428699636';
const UNLOCK_KEY = 'sp211-demos-unlocked';

async function sha256hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => {
    try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch { return false; }
  });
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  if (unlocked) return children;

  const submit = async (e) => {
    e.preventDefault();
    setError(false);
    setChecking(true);
    let hex = '';
    try { hex = await sha256hex(value.trim()); } catch { /* insecure context */ }
    setChecking(false);
    if (hex === PW_SHA256) {
      try { localStorage.setItem(UNLOCK_KEY, '1'); } catch { /* private mode */ }
      setUnlocked(true);
    } else {
      setError(true);
      setValue('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: 'radial-gradient(120% 120% at 50% 0%, #012 0%, #001233 55%, #00060f 100%)' }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl p-8 text-center"
        style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(197,183,131,0.3)' }}
      >
        <img
          src={`${import.meta.env.BASE_URL}usna-logo-small.png`}
          alt="USNA"
          className="h-16 mx-auto mb-5 opacity-90"
        />
        <h1 className="text-xl font-bold mb-1" style={{ color: '#F0ECE3' }}>SP211 Physics Demos</h1>
        <p className="text-sm mb-5" style={{ color: '#8B8C8E' }}>Enter the class password to continue.</p>

        <input
          type="password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          autoFocus
          autoComplete="off"
          aria-label="Class password"
          placeholder="password"
          className="w-full rounded-lg px-3 py-2 text-center font-mono outline-none focus:ring-2"
          style={{
            background: '#0D1321',
            border: `1px solid ${error ? '#E06C6C' : 'rgba(197,183,131,0.35)'}`,
            color: '#F0ECE3',
          }}
        />

        {error && (
          <p className="text-sm mt-2" style={{ color: '#E06C6C' }}>Incorrect password — try again.</p>
        )}

        <button
          type="submit"
          disabled={checking}
          className="mt-5 w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-60"
          style={{ background: '#C5B783', color: '#00205B' }}
        >
          {checking ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </div>
  );
}
