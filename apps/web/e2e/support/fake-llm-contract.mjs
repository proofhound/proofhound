// Shared, dependency-free constants for the fake LLM server and the e2e specs.
// Kept in a separate file so both the webServer process and test files import the same values.
export const FAKE_LLM_PORT = Number(process.env.FAKE_LLM_PORT ?? 5599);
export const FAKE_LLM_BASE_URL = `http://127.0.0.1:${FAKE_LLM_PORT}`;
// Provider endpoint stored on the seeded model; OpenAI adapter appends `/chat/completions`.
export const FAKE_LLM_ENDPOINT = `${FAKE_LLM_BASE_URL}/v1`;

// Marker the optimizer's `generate` step injects into the new prompt body. When the rendered
// inference prompt contains this marker, the fake server echoes the answer wrapped in <ANS>…</ANS>.
export const OPT_MARKER = '[OPT_MARKER_V1]';
export const ANS_OPEN = '<ANS>';
export const ANS_CLOSE = '</ANS>';
// Decision the fake returns for any inference WITHOUT the marker (baseline → always wrong).
export const BASELINE_WRONG = '__BASELINE_WRONG__';
