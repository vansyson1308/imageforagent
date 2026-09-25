# Feedback log — Nebius Token Factory, Nemotron, Tavily

Concrete, reproducible notes gathered while building. Feeds the Devpost "feedback" field.
Each entry: date · component · observation · how to reproduce · severity/suggestion.

## Token Factory API

- 2026-09-25 · docs · The public docs host (`docs.tokenfactory.nebius.com`) is the only place the vision message format and the per-model thinking toggle are documented. Sandboxed agent environments that allowlist GitHub but not arbitrary domains can't read them. Suggestion: mirror the API reference (OpenAPI spec + model capability table: image input yes/no, thinking control key, JSON-schema support) in a public GitHub repo. We had to rely on Nebius's `nebius-physical-ai` repo for the `image_url` format and `chat_template_kwargs.enable_thinking`.
- 2026-09-25 · models endpoint · Model-list membership doesn't tell you a model's capabilities. Nebius's own verification report notes that a listed multimodal model rejected images with HTTP 400. Suggestion: add `capabilities: {vision, json_schema, reasoning_toggle}` to `GET /v1/models` entries.

## Nemotron models (per role)

_(Live observations are pending. See BLOCKERS B1/B3.)_

## Tavily

- 2026-09-25 · docs · The official Python client source was enough to derive exact request/response shapes for a no-SDK `fetch` integration. Good.
