export function getApiErrorMessage(error: unknown): string | undefined {
  const responseData = getResponseData(error);
  const responseMessage = getMessageValue(responseData);
  if (responseMessage) return responseMessage;

  if (error instanceof Error && error.message) return error.message;
  return undefined;
}

function getResponseData(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  const response = error['response'];
  if (!isRecord(response)) return undefined;
  return response['data'];
}

function getMessageValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!isRecord(value)) return undefined;

  for (const key of ['message', 'errorMessage', 'error']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (Array.isArray(candidate)) {
      const messages = candidate.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      if (messages.length > 0) return messages.join('\n');
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
