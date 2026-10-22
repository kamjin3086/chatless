import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteFailureView } from '../RouteFailureView';
import { canReturnToChat, describeRouteFailure } from '../routeFailure';

describe('what a failed route keeps visible', () => {
  it('carries the message, route and stack', () => {
    const details = describeRouteFailure(new Error('boom'), '/knowledge');
    expect(details.message).toBe('boom');
    expect(details.route).toBe('/knowledge');
    expect(details.stack).toContain('boom');
  });

  it('turns a thrown non-Error into text instead of hiding it', () => {
    expect(describeRouteFailure('plain failure', '/chat').message).toBe(
      'plain failure',
    );
    expect(describeRouteFailure('', '/chat').route).toBe('/chat');
  });

  it('falls back to the error name when the message is empty', () => {
    expect(describeRouteFailure(new Error(''), '/settings').message).toBe(
      'Error',
    );
  });

  it('keeps the component stack when React provides one', () => {
    expect(
      describeRouteFailure(new Error('x'), '/chat', '  at Broken\n  at App  ')
        .componentStack,
    ).toBe('at Broken\n  at App');
  });

  it('uses / when the route is empty', () => {
    expect(describeRouteFailure(new Error('x'), '').route).toBe('/');
  });
});

describe('the way back', () => {
  it('is offered away from /chat and omitted on /chat itself', () => {
    expect(canReturnToChat('/knowledge')).toBe(true);
    expect(canReturnToChat('/chat')).toBe(false);
  });
});

describe('the failure surface', () => {
  const labels = {
    title: 'This page hit an error',
    description: 'Your conversation is still here.',
    routeLabel: 'Failed route: {0}',
    detailsLabel: 'Error details',
    retryLabel: 'Retry',
    backLabel: 'Back to chats',
  };

  it('shows the route, the message and both ways out', () => {
    const html = renderToStaticMarkup(
      React.createElement(RouteFailureView, {
        ...labels,
        details: describeRouteFailure(new Error('boom'), '/knowledge'),
        canGoBack: true,
        onRetry: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain('Failed route: /knowledge');
    expect(html).toContain('boom');
    expect(html).toContain('Retry');
    expect(html).toContain('Back to chats');
  });

  it('still shows the route when a locale omits the placeholder', () => {
    const html = renderToStaticMarkup(
      React.createElement(RouteFailureView, {
        ...labels,
        routeLabel: 'Failed route:',
        details: describeRouteFailure(new Error('boom'), '/knowledge'),
        canGoBack: true,
        onRetry: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain('/knowledge');
  });

  it('omits the back button on the chat route itself', () => {
    const html = renderToStaticMarkup(
      React.createElement(RouteFailureView, {
        ...labels,
        details: describeRouteFailure(new Error('boom'), '/chat'),
        canGoBack: false,
        onRetry: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain('Retry');
    expect(html).not.toContain('Back to chats');
  });
});
