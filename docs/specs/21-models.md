# 21 · Models

## 1. Page Role

"Models" maintains the LLM configurations available to the current self-hosted instance. A model is the smallest unit through which ProofHound invokes an LLM:

- Provider type
- Provider model ID
- Endpoint
- API Key
- Context length
- RPM / TPM / concurrency limits
- Input / output token unit prices
- Capability declarations
- Extra Body

Models belong to the default local project.

Model names are unique within a project; when creating, editing, or copying a model, the name must not collide with an existing (non-deleted) model in the same project. When the user enters a name, if the frontend detects a duplicate within the project it should warn "This name is already in use", while the backend still enforces this via a uniqueness constraint as a fallback.

## 2. List Contents

Each row shows:

- Name
- Provider type
- Model ID
- Status
- Context length
- RPM / TPM / concurrency limits
- Input / output token unit prices
- Image capability
- Latest probe time / error
- Updated time

## 3. Actions

- Create a model.
- Save as draft: create a disabled model whose configuration is retained but does not enter the run channel.
- Quickly create presets for mainstream models, then fill in credentials, quotas, unit prices, and capability declarations.
- Edit model configuration.
- Enable / disable a model.
- Delete a model; rejected when referenced by a running task or an online release.
- Copy a model.
- Export the model list as CSV.
- Pre-save draft connectivity probe.
- Saved-model connectivity probe.
- View / copy the plaintext of a saved API Key.

A draft connectivity probe initiated on the create-model page before saving does not create a model, but the returned probe result must be retained in the page state. When the user subsequently clicks "Save as draft" or "Save and enable", if the most recent draft probe corresponds to the current form content, the create endpoint must write that result into the model's latest probe time and error fields; after a successful save it returns uniformly to the model list page. If the user changes any configuration that affects connectivity after probing, that draft probe is no longer attached to the create record.

## 4. Endpoint Compatibility Rules

An OpenAI-compatible Endpoint supports three input formats:

- Full request URL: used as-is when it ends with `/chat/completions`.
- API root already carrying a version: when it ends with `/v1`, `/v2`, `/v1beta`, `/openai`, etc., only `/chat/completions` is appended.
- Plain host / gateway path: `/v1/chat/completions` is appended by default.

DeepSeek / KIMI / MiniMax / Qwen / ERNIE and others can be sent over the OpenAI-compatible protocol; `provider_type` is still retained, used for filtering and subsequent adaptation.

## 5. Model Context Dictionary

`model_context_windows` stores the current mapping from provider model ID to context length:

- The key is `provider_model_id`.
- The value is `context_window_tokens`.
- No historical versioning.
- The default value can be read when creating / editing a model, and can also be overridden manually.

## 6. RPM / TPM / Concurrency

The three limits are mutually independent:

| Quota       | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| RPM         | Number of requests in the most recent 60-second sliding window                |
| TPM         | Input + output tokens in the most recent 60-second sliding window             |
| Concurrency | Number of in-flight requests at the same time (the concurrency limit when auto concurrency is on) |

RPM / TPM allow `-1` to indicate no limit at the model layer; a positive runtime / deployment / plan cap from `RuntimeLimitsProvider` still applies when the model layer is unlimited. Concurrency must be `1..999`. All entries share the same effective quota, counted uniformly by the centralized Redis rate limiter through the opaque key produced by `LimiterKeyStrategy` ([08 §3.7](08-saas-adapter-boundary.md#37-limiterkeystrategy)); the OSS default key is `model:<modelId>`.

Experiment- / optimization-level rate limits can only tighten downward; they cannot exceed the model's limits.

### 6.1 Auto Concurrency

RPM / TPM are the hard quota limits given by the provider, but "how large a concurrency is needed to exactly saturate them" depends on real-time latency and per-request token count, which is hard for users to compute by hand; and the actually attainable throughput is often lower than the configured limits (provider quota discounts, upstream 429s, latency fluctuations). The model therefore has an `auto_concurrency` switch, **on by default**:

- When on, the system automatically adjusts the actual effective concurrency within the `[1, concurrency limit]` range, and `concurrency_limit` degrades to a safety cap / manually entered cap.
- When off, `concurrency_limit` is the hard concurrency cap, with behavior consistent with the past.

The adjustment strategy is **hybrid**, with state maintained centrally by Redis (per opaque limiter key produced by `LimiterKeyStrategy`, an independent autostate hash key):

1. **Target concurrency (Little's Law)**: `effective ≈ requests per second needed to achieve RPM/TPM × average latency`. Using an observed-latency EWMA and a per-request-token EWMA, it derives in real time the concurrency that exactly saturates RPM/TPM, then clamps it to `[1, concurrency limit]`. When RPM/TPM is `-1` (no limit), that side does not participate in the constraint.
2. **Upstream 429 multiplicative backoff (AIMD)**: when the provider returns a 429 (insufficient quota), concurrency converges via a multiplier, and recovers additively after sustained success. This makes concurrency (and therefore the actual throughput) converge to the level the provider can genuinely sustain, rather than hammering the configured RPM/TPM.

The system does not force the configured RPM/TPM to be saturated, only "up to at most"; the configured value is always the upper bound. The effective value and the backoff state are visible to the user (the concurrency usage in the list / details shows `effective / limit`, and the application log records the derivation process).

Note: what is adjusted here is the **limiter-key-dimension global in-flight concurrency** (shared across all worker processes / all entries that resolve to the same key; OSS default key remains `model:<modelId>`), which is a separate gate from the worker process's own BullMQ pull concurrency (see [03 §7](03-orchestration.md#7-division-of-responsibilities)).

## 7. Unit Price and Cost Estimation

The model maintains:

- `input_token_price_per_million`
- `output_token_price_per_million`

Cost estimation for a run result:

```text
input_tokens / 1_000_000 * input_token_price_per_million
+ output_tokens / 1_000_000 * output_token_price_per_million
```

Fill in `0` for an unknown unit price.

## 8. Capability Declarations

The model declares:

- Whether images are supported.
- Whether images support URL.
- Whether images support base64.

As long as a model declares image support, it is treated as supporting multiple image inputs. Before running, the model's capabilities are validated against the prompt variables and dataset fields.

When an inline image exceeds the safety cap, the LLM layer scales / re-encodes it; remote image URLs are not actively downloaded or rewritten, to avoid introducing SSRF and private-URL leakage risks.

## 9. Extra Body

`extra_body` stores provider-specific request parameters and must be a JSON object. It is merged into the provider request body at runtime, but core fields take higher priority: it cannot override `model`, `messages`, the output structure, or other ProofHound-generated fields.

## 10. Deletion Restrictions

Deletion is rejected when referenced by the following objects:

- A running experiment / optimization.
- A running canary candidate.
- A running production lane.

A model that was referenced by historically finished objects may be physically deleted; historical run results can still display that model reference.

## 11. Credential Security

- The API Key is treated as ciphertext both in transit and at rest.
- The list and details show a masked value by default.
- Viewing the plaintext is only triggered explicitly within local admin app interactions.
- Logs must not write the plaintext API Key.
