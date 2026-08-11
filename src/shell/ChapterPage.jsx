import { useParams, Link, Navigate } from 'react-router-dom';
import { findCourse, findChapter } from '../registry';

export default function ChapterPage() {
  const { courseId, chapterSlug } = useParams();
  const course = findCourse(courseId);
  const chapter = findChapter(courseId, chapterSlug);

  if (!chapter) return <Navigate to={course ? `/${courseId}` : '/'} replace />;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-usna-gold mb-1">
        Chapter {chapter.number}: {chapter.title}
      </h1>
      <p className="text-usna-muted mb-8">{course.title} — {course.subtitle}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {chapter.experiments.map((exp) => (
          <Link
            key={exp.slug}
            to={`/${courseId}/${chapterSlug}/${exp.slug}`}
            className="group block bg-usna-card border border-usna-grid rounded-lg p-5 hover:border-usna-gold transition-colors"
          >
            <h3 className="text-sm font-medium text-usna-gold group-hover:text-usna-gold-light">
              {exp.title}
            </h3>
            {exp.description && (
              <p className="text-usna-muted text-xs mt-1">{exp.description}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
