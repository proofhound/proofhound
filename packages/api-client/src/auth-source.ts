/**
 * AuthSource — pluggable credential provider for the HTTP client.
 *
 * OSS deployment (Forms A / B / C per 08 §3.2.1): the browser sends no
 * credential; identity is established at the deployment layer (trusted
 * reverse-proxy header or LOCAL_ACTOR env-var fallback). `LocalAuthSource`
 * reflects this by returning null so no Authorization header is injected.
 *
 * A future replacement implementation that issues per-user tokens can subclass AuthSource
 * and return the token string; the interceptor in configure.ts picks it up
 * automatically.
 */
export abstract class AuthSource {
  /**
   * Returns a Bearer token to attach, or null.
   * Returning null means the interceptor will omit the Authorization header
   * entirely — the OSS default.
   */
  abstract getToken(): Promise<string | null>;
}

/**
 * Default OSS implementation: no browser-side credential.
 * Deployment-layer auth (reverse-proxy header / LOCAL_ACTOR) is handled
 * server-side; the client does not need to carry a token.
 */
export class LocalAuthSource extends AuthSource {
  async getToken(): Promise<string | null> {
    return null;
  }
}
