import { describe, expect, it } from 'vitest';
import { describeClientFailure } from '../clientFailure';

describe('development WebView failure report', () => {
  it('keeps only the error type, known route and generated source positions', () => {
    const error = new TypeError('secret message');
    error.stack =
      'TypeError: secret message\n    at secretFunction (http://localhost:3000/_next/static/chunks/main-app.js:20:7)\n    at webpack-internal:///(app-pages-browser)/./src/app/layout.tsx:46:3\n    at /home/private/config.ts:4:2';
    expect(describeClientFailure(error, '/settings/', 'render')).toEqual({
      route: '/settings',
      kind: 'render',
      name: 'TypeError',
      locations: ['main-app.js:20:7', 'src/app/layout.tsx:46:3'],
    });
  });

  it('does not serialize arbitrary rejection reasons or unknown routes', () => {
    expect(
      describeClientFailure(
        { token: 'secret' },
        '/unknown/private',
        'rejection',
      ),
    ).toEqual({
      route: '[other]',
      kind: 'rejection',
      name: 'Unknown',
      locations: [],
    });
  });
});
