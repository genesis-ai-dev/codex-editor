# Auth Server ASR Proxy Implementation Guide

> **This document was rewritten in 2026 to reflect the current OmniASR
> (HTTP POST) contract.** The previous WebSocket-based MMS proxy described
> here is no longer in use.

## Status

- **Upstream service**: Meta Omnilingual ASR (`omniASR_LLM_1B_v2`), served
  on Modal as `https://genesis-ai-dev--codex-asr-serve.modal.run`
  (renamed from the historical `mms-zeroshot-asr` deployment — same
  workload, model-agnostic name).
- **Client**: Codex Editor talks to the Frontier auth-proxy via plain
  HTTP POST (multipart). No WebSocket. See
  [`asr-proxy-endpoint.md`](./asr-proxy-endpoint.md) for the full wire spec
  and reference FastAPI implementation.

## What the auth server must implement

### 1. `getAsrEndpoint()` on FrontierAPI

```typescript
getAsrEndpoint(): Promise<string | undefined>
```

Returns the **HTTPS** URL of the proxy's transcribe endpoint
(e.g. `https://auth.frontier.example/api/v1/asr/transcribe`). The client
performs a multipart POST against that URL.

This mirrors the existing `getLlmEndpoint()`.

### 2. `POST /api/v1/asr/transcribe` proxy endpoint

A pass-through that:

1. Validates the Frontier JWT (Authorization header or `?token=` query).
2. Forwards the multipart audio body to OmniASR.
3. **Forwards the optional `?lang=...` query parameter** when the client
   supplies it (OmniASR `{iso639_3}_{Script}` format, e.g. `swh_Latn`).
   In auto-detect mode the client omits `lang`; the proxy must also omit
   it when calling upstream.
4. Returns OmniASR's JSON response verbatim (`text`, `duration_s`,
   `inference_s`, and `lang` when one was sent).

A complete reference FastAPI implementation is in
[`asr-proxy-endpoint.md`](./asr-proxy-endpoint.md#example-implementation-pythonfastapi).

## Migration from the WebSocket / MMS era

Anything the client used to send over WebSocket (provider, model,
language as bare ISO 639-3, phonetic flag, etc.) is gone:

- **No more `provider` / `model` fields**: the upstream is OmniASR; the
  client doesn't choose providers.
- **No more `phonetic`**: OmniASR doesn't support IPA output.
- **No more bare ISO 639-3 codes**: OmniASR requires `{iso639_3}_{Script}`
  (e.g. `urd_Arab`, not `urd`). The client resolves this from the project
  language using `sharedUtils/asrLanguageUtils.ts`.
- **No more `lang=auto` magic value**: omit `lang` entirely for
  auto-detect.

## Key references

- Wire contract: [`docs/asr-proxy-endpoint.md`](./asr-proxy-endpoint.md)
- Client: `webviews/codex-webviews/src/CodexCellEditor/WhisperTranscriptionClient.ts`
- Lang resolver + supported codes: `sharedUtils/asrLanguageUtils.ts`,
  `sharedUtils/omniAsrSupportedLangs.ts`,
  `sharedUtils/omniAsrDefaultScripts.ts`,
  `sharedUtils/omniAsrFriendlyNames.ts`
- Modal app (source of truth for the upstream):
  [`docs/asr/codex_asr_modal.py`](./asr/codex_asr_modal.py) in this repo.
  Logs and dashboards:
  <https://modal.com/apps/genesis-ai-dev/main/deployed/codex-asr>.

## Action items for the Frontier auth proxy team

1. Point the upstream ASR URL at the new app:
   `https://genesis-ai-dev--codex-asr-serve.modal.run/transcribe`
   (previously `…--mms-zeroshot-asr-…`). The legacy app is still up so
   there's no urgency, but it should not be considered the source of
   truth — only `codex-asr` will receive future updates.
2. Make sure the proxy forwards the optional `?lang=` query string
   verbatim and does not synthesise one when the client omits it
   (auto-detect mode).
3. Drop any `provider`, `model`, `phonetic`, `language` fields that
   used to be part of the multipart/form body — they're no longer sent.
4. Once the proxy is migrated, we can decommission the
   `mms-zeroshot-asr` Modal app.
