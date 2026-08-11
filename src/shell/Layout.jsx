import { NavLink, useLocation } from 'react-router-dom';
import { useTheme } from '../shared/ThemeContext';
import courses from '../registry';

export default function Layout({ children }) {
  const location = useLocation();
  const isHome = location.pathname === '/';
  const { dark, toggle } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-usna-deep transition-colors">
      {/* Nav bar */}
      <nav className="bg-usna-navy px-6 py-3 flex items-center gap-6 sticky top-0 z-50 shadow-lg">
        <NavLink to="/" className="flex items-center gap-3 shrink-0">
          <img
            src="./usna-logo-small.png"
            alt="USNA Crest"
            className="h-9 w-auto"
          />
          <h1 className="text-[#C5B783] font-semibold text-lg tracking-tight hidden sm:block">
            USNA Physics Demos
          </h1>
        </NavLink>

        {/* Course-level links */}
        <div className="flex gap-1 overflow-x-auto flex-1">
          {courses.map(({ id, title }) => (
            <NavLink
              key={id}
              to={`/${id}`}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'text-[#C5B783] border-b-2 border-[#C5B783]'
                    : 'text-[#F0ECE3] hover:text-[#D4C99E]'
                }`
              }
            >
              {title}
            </NavLink>
          ))}
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggle}
          className="shrink-0 p-2 rounded-lg text-[#F0ECE3] hover:bg-white/10 transition-colors"
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={dark ? 'Light mode' : 'Dark mode'}
        >
          {dark ? (
            /* Sun icon */
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            /* Moon icon */
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </nav>

      {/* Breadcrumb (below nav, non-home pages) */}
      {!isHome && <Breadcrumb />}

      {/* Main content */}
      <main className="flex-1 p-6 max-w-[1600px] mx-auto w-full">
        {children}
      </main>

      {/* Footer */}
      <footer className="text-center text-usna-muted text-xs py-4 border-t border-usna-grid">
        USNA Physics Department
      </footer>
    </div>
  );
}

function Breadcrumb() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const crumbs = [{ label: 'Home', to: '/' }];

  if (parts[0]) {
    const course = courses.find((c) => c.id === parts[0]);
    if (course) {
      crumbs.push({ label: course.title, to: `/${course.id}` });
      if (parts[1]) {
        const chapter = course.chapters.find((ch) => ch.slug === parts[1]);
        if (chapter) {
          crumbs.push({ label: `Ch. ${chapter.number}: ${chapter.title}`, to: `/${course.id}/${chapter.slug}` });
          if (parts[2]) {
            const exp = chapter.experiments.find((e) => e.slug === parts[2]);
            if (exp) crumbs.push({ label: exp.title, to: null });
          }
        }
      }
    }
  }

  return (
    <div className="bg-usna-card border-b border-usna-grid px-6 py-2 text-sm text-usna-muted transition-colors">
      {crumbs.map((c, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-2">/</span>}
          {c.to ? (
            <NavLink to={c.to} className="hover:text-usna-gold transition-colors">
              {c.label}
            </NavLink>
          ) : (
            <span className="text-usna-text">{c.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
