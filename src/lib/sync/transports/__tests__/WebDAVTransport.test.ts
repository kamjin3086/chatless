import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncMetadataFile } from '../../core/types';
import { WebDavClient } from '../../webdav/WebDavClient';
import { WebDAVTransport } from '../WebDAVTransport';

const transport = () =>
  new WebDAVTransport({
    url: 'https://example.test',
    basePath: '',
    username: 'user',
    password: '',
  });
const metadata: SyncMetadataFile = { version: 1, updated_at: 1, items: {} };
const item = { id: 'one', updated_at: 1 };

afterEach(() => vi.restoreAllMocks());

describe('WebDAV conditional writes', () => {
  it('creates missing resources with If-None-Match instead of overwriting a concurrent creator', async () => {
    const request = vi
      .spyOn(WebDavClient.prototype, 'request')
      .mockResolvedValue({ status: 201, statusText: '' });
    const dav = transport();

    await dav.putMetadata('metadata.json', metadata, null);
    await dav.putItem('one.json', item, null);

    for (const [method, , options] of request.mock.calls) {
      expect(method).toBe('PUT');
      expect(options?.headers).toMatchObject({ 'If-None-Match': '*' });
      expect(options?.headers).not.toHaveProperty('If-Match');
    }
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('uses the exact observed ETag when replacing an existing resource', async () => {
    const request = vi
      .spyOn(WebDavClient.prototype, 'request')
      .mockResolvedValue({ status: 204, statusText: '' });
    await transport().putItem('one.json', item, '"before"');
    expect(request.mock.calls[0]?.[2]?.headers).toMatchObject({
      'If-Match': '"before"',
    });
  });

  it('reports failed GETs instead of reporting an absent resource', async () => {
    vi.spyOn(WebDavClient.prototype, 'request')
      .mockResolvedValueOnce({ status: 503, statusText: 'Unavailable' })
      .mockResolvedValueOnce({ status: 200, statusText: '', text: 'not JSON' })
      .mockResolvedValueOnce({ status: 404, statusText: 'Not found' });
    const dav = transport();

    await expect(dav.getMetadata('metadata.json')).rejects.toThrow('503');
    await expect(dav.getItem('one.json')).rejects.toThrow();
    await expect(dav.getItem('missing.json')).resolves.toMatchObject({
      data: null,
    });
  });
});
