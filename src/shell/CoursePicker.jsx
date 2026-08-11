import { Link } from 'react-router-dom';
import courses from '../registry';

export default function CoursePicker() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <img
          src="./usna-logo-small.png"
          alt="USNA Crest"
          className="h-20 w-auto mx-auto mb-4"
        />
        <h1 className="text-3xl font-bold text-usna-gold mb-2">USNA Physics Demos</h1>
        <p className="text-usna-muted text-lg">
          Interactive demonstrations for undergraduate physics courses.
        </p>
        <p className="text-usna-muted text-sm mt-1">
          United States Naval Academy &middot; Physics Department
        </p>
      </div>

      {/* Featured: the Day-1 Semester Preview performance (separate from chapter nav) */}
      <Link
        to="/sp211/semester-preview"
        className="group block mb-6 rounded-lg p-6 bg-usna-navy border border-usna-gold/40 hover:border-usna-gold transition-colors"
      >
        <div className="flex items-center gap-4">
          <span className="shrink-0 grid place-items-center w-12 h-12 rounded-full bg-usna-gold/15 text-usna-gold text-2xl group-hover:bg-usna-gold/25 transition-colors">
            ▶
          </span>
          <div>
            <h2 className="text-xl font-semibold text-usna-gold">SP211 Semester Preview</h2>
            <p className="text-[#F0ECE3] text-sm">
              A full-screen, live-demo tour of the semester ahead.
            </p>
          </div>
        </div>
      </Link>

      <div className="grid gap-6 sm:grid-cols-2">
        {courses.map((course) => {
          const expCount = course.chapters.reduce((n, ch) => n + ch.experiments.length, 0);
          return (
            <Link
              key={course.id}
              to={`/${course.id}`}
              className="group block bg-usna-card border border-usna-grid rounded-lg p-6 hover:border-usna-gold transition-colors"
            >
              <h2 className="text-xl font-semibold text-usna-gold group-hover:text-usna-gold-light mb-1">
                {course.title}
              </h2>
              <p className="text-usna-text text-sm mb-3">{course.subtitle}</p>
              <p className="text-usna-muted text-sm">{course.description}</p>
              <p className="text-usna-muted text-xs mt-4">
                {course.chapters.length} chapter{course.chapters.length !== 1 ? 's' : ''} &middot;{' '}
                {expCount} demo{expCount !== 1 ? 's' : ''}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
