import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';

import { httpClient } from './http';
import { LocalAuthSource } from './auth-source';
import { configureApiClient } from './configure';

// Capture the last request config sent through the interceptor pipeline
// by replacing the adapter with a no-op that records the config.
function installCapturingAdapter(): { captured: InternalAxiosRequestConfig | null } {
  const state: { captured: InternalAxiosRequestConfig | null } = { captured: null };
  httpClient.defaults.adapter = async (config) => {
    state.captured = config;
    return {
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  return state;
}

const originalAdapter = httpClient.defaults.adapter;
const originalBaseURL = httpClient.defaults.baseURL;

describe('configureApiClient', () => {
  afterEach(() => {
    // Restore adapter and baseURL between tests so tests are isolated.
    httpClient.defaults.adapter = originalAdapter;
    httpClient.defaults.baseURL = originalBaseURL;
    // Eject all interceptors to prevent cross-test pollution.
    // Axis doesn't expose a clear-all but eject(0..N) is safe.
    for (let i = 0; i < 10; i++) {
      httpClient.interceptors.request.eject(i);
    }
  });

  it('adds Authorization: Bearer header when authSource.getToken() returns a token', async () => {
    const state = installCapturingAdapter();
    const tokenSource = {
      async getToken() {
        return 'tok-abc123';
      },
    };

    configureApiClient({
      authSource: tokenSource as LocalAuthSource,
      getProjectId: () => 'proj-1',
    });

    await httpClient.get('/x');

    expect(state.captured?.headers.get('Authorization')).toBe('Bearer tok-abc123');
    expect(state.captured?.headers.get('X-Project-Id')).toBe('proj-1');
  });

  it('does NOT add Authorization header when getToken() returns null (OSS default)', async () => {
    const state = installCapturingAdapter();

    configureApiClient({
      authSource: new LocalAuthSource(),
      getProjectId: () => 'proj-oss',
    });

    await httpClient.get('/x');

    // When not set, AxiosHeaders.get() returns undefined at runtime
    expect(state.captured?.headers.get('Authorization')).toBeFalsy();
    expect(state.captured?.headers.get('X-Project-Id')).toBe('proj-oss');
  });

  it('sets X-Project-Id from getProjectId()', async () => {
    const state = installCapturingAdapter();

    configureApiClient({
      authSource: new LocalAuthSource(),
      getProjectId: () => 'proj-xyz',
    });

    await httpClient.get('/x');

    expect(state.captured?.headers.get('X-Project-Id')).toBe('proj-xyz');
  });

  it('overrides baseURL when baseUrl option is provided', async () => {
    const state = installCapturingAdapter();

    configureApiClient({
      authSource: new LocalAuthSource(),
      getProjectId: () => 'proj-1',
      baseUrl: 'http://custom-server:4000',
    });

    await httpClient.get('/x');

    expect(httpClient.defaults.baseURL).toBe('http://custom-server:4000');
    // The request should have been sent (adapter was reached)
    expect(state.captured).not.toBeNull();
  });

  it('is idempotent: re-configuring does not double-add Authorization', async () => {
    const state = installCapturingAdapter();
    const tokenSource = {
      async getToken() {
        return 'tok-reconfig';
      },
    };

    // Call configureApiClient twice — simulates hot re-config
    configureApiClient({
      authSource: tokenSource as LocalAuthSource,
      getProjectId: () => 'proj-1',
    });
    configureApiClient({
      authSource: tokenSource as LocalAuthSource,
      getProjectId: () => 'proj-2',
    });

    await httpClient.get('/x');

    // Authorization must appear exactly once (not duplicated)
    const authHeader = state.captured?.headers.get('Authorization');
    expect(authHeader).toBe('Bearer tok-reconfig');
    // getProjectId from the second call wins
    expect(state.captured?.headers.get('X-Project-Id')).toBe('proj-2');
  });

  it('does not set X-Project-Id when getProjectId() returns empty string', async () => {
    const state = installCapturingAdapter();

    configureApiClient({
      authSource: new LocalAuthSource(),
      getProjectId: () => '',
    });

    await httpClient.get('/x');

    // When not set, AxiosHeaders.get() returns undefined at runtime
    expect(state.captured?.headers.get('X-Project-Id')).toBeFalsy();
  });
});
