import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import Layout from './shell/Layout';
import CoursePicker from './shell/CoursePicker';
import CoursePage from './shell/CoursePage';
import ChapterPage from './shell/ChapterPage';
import ExperimentPage from './shell/ExperimentPage';

// Full-screen presentation deck — its own route, outside the shell chrome.
const SemesterPreview = lazy(() => import('./courses/sp211/semester-preview/SemesterPreview'));

export default function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        {/* Full-screen route: no nav/breadcrumb/footer */}
        <Route path="/sp211/semester-preview" element={<SemesterPreview />} />
        {/* Everything else runs inside the standard shell */}
        <Route path="/*" element={<Shell />} />
      </Routes>
    </Suspense>
  );
}

function Shell() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<CoursePicker />} />
        <Route path="/:courseId" element={<CoursePage />} />
        <Route path="/:courseId/:chapterSlug" element={<ChapterPage />} />
        <Route path="/:courseId/:chapterSlug/:experimentSlug" element={<ExperimentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-usna-gold border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
