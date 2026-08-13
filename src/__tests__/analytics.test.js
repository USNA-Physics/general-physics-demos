import { describe, it, expect } from 'vitest';
import { buildPageLocation } from '../analytics';
import { pageTitle } from '../shell/RouteAnalytics';

describe('buildPageLocation — folds hash route into a real path for GA4', () => {
  it('joins a GitHub Pages subpath without doubling the slash', () => {
    expect(
      buildPageLocation('https://usna-physics.github.io', '/general-physics-demos/', '/sp211/ch02-motion-1d/grapher?mode=area'),
    ).toBe('https://usna-physics.github.io/general-physics-demos/sp211/ch02-motion-1d/grapher?mode=area');
  });

  it('works at the site root (local dev)', () => {
    expect(buildPageLocation('http://localhost:5173', '/', '/sp211')).toBe('http://localhost:5173/sp211');
  });

  it('normalizes a path missing its leading slash', () => {
    expect(buildPageLocation('http://x', '/base/', 'foo')).toBe('http://x/base/foo');
  });

  it('handles the home route', () => {
    expect(buildPageLocation('http://x', '/base/', '/')).toBe('http://x/base/');
  });
});

describe('pageTitle — human-readable GA page_title from the registry', () => {
  it('home', () => {
    expect(pageTitle('/', '')).toBe('USNA Physics Demos');
  });

  it('course', () => {
    expect(pageTitle('/sp211', '')).toMatch(/SP211/);
  });

  it('chapter includes the chapter number and title', () => {
    const t = pageTitle('/sp211/ch02-motion-1d', '');
    expect(t).toMatch(/Ch 2/);
    expect(t).toMatch(/Motion in One Dimension/);
  });

  it('experiment uses the demo display name', () => {
    expect(pageTitle('/sp211/ch02-motion-1d/grapher', '')).toMatch(/1D Motion Grapher/);
  });

  it('experiment appends the active mode label', () => {
    expect(pageTitle('/sp211/ch02-motion-1d/grapher', '?mode=area')).toMatch(/Area = integral/);
  });

  it('does not append the label for the default (first) mode', () => {
    expect(pageTitle('/sp211/ch02-motion-1d/grapher', '?mode=default')).not.toMatch(/—/);
  });

  it('full-screen semester preview', () => {
    expect(pageTitle('/sp211/semester-preview', '')).toMatch(/Semester Preview/);
  });

  // The crash-risk guard: RouteAnalytics runs pageTitle on EVERY navigation,
  // so unknown / malformed routes must degrade gracefully, never throw.
  it.each([
    ['/does-not-exist', ''],
    ['/sp211/nope', ''],
    ['/sp211/ch02-motion-1d/nope', ''],
    ['/sp211/ch02-motion-1d/grapher', '?mode=bogus'],
    ['//', ''],
    ['', ''],
  ])('never throws and returns a non-empty string for %s %s', (path, search) => {
    let title;
    expect(() => { title = pageTitle(path, search); }).not.toThrow();
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);
  });
});
