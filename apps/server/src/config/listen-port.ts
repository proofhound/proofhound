type ListenPortSource = 'PORT' | 'SERVER_PORT';
type ListenPortEnv = Partial<Record<ListenPortSource, string | number | undefined>>;

const DEFAULT_SERVER_PORT = 4000;

export function resolveListenPort(env: ListenPortEnv): {
  port: number;
  source: ListenPortSource;
} {
  const railwayPort = parsePort(env.PORT, 'PORT');
  if (railwayPort !== undefined) {
    return { port: railwayPort, source: 'PORT' };
  }

  return {
    port: parsePort(env.SERVER_PORT, 'SERVER_PORT') ?? DEFAULT_SERVER_PORT,
    source: 'SERVER_PORT',
  };
}

function parsePort(value: string | number | undefined, source: ListenPortSource): number | undefined {
  if (value === undefined) return undefined;

  const port = Number(value);
  if (Number.isInteger(port) && port > 0) return port;

  throw new Error(`${source}_must_be_a_positive_integer`);
}
