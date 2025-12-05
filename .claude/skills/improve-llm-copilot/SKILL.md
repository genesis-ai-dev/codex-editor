---
name: improve-llm-copilot
description: Modify LLM/AI copilot functionality. Use when changing translation suggestions, chat behavior, prompt engineering, or AI model configuration.
---

# Improve LLM/Copilot

## Key Files

- `src/utils/llmUtils.ts` - Config fetching, API setup
- `src/providers/translationSuggestions/llmCompletion.ts` - Translation logic
- `src/smartEdits/` - Smart edit commands, chat
- `src/copilotSettings/` - User-facing settings
- `webviews/codex-webviews/src/CopilotSettings/` - Settings UI

## Modify Translation Prompt

Edit `src/providers/translationSuggestions/llmCompletion.ts`:

```typescript
const systemPrompt = `You are a Bible translation assistant...`;
const userPrompt = buildTranslationPrompt(sourceText, context);
```

## Add LLM Feature

1. **Config** in `src/utils/llmUtils.ts`:
```typescript
export async function fetchCompletionConfig(): Promise<CompletionConfig> {
    // Add new config options
}
```

2. **Completion call**:
```typescript
import { llmCompletion } from "../providers/translationSuggestions/llmCompletion";
const result = await llmCompletion(prompt, config);
```

3. **Settings UI** in `webviews/codex-webviews/src/CopilotSettings/`

## Smart Edits System

`src/smartEdits/`:
- `registerSmartEditCommands.ts` - Command registration
- `chat.ts` - Chat functionality (see TODO: memory management)

## API Integration

Uses OpenAI SDK (`openai@4.67.3`):
```typescript
import OpenAI from "openai";
const client = new OpenAI({ apiKey, baseURL });
```

## A/B Testing

See `src/utils/abTestingSetup.ts` and `docs/AB_TESTING.md` for feature experiments.

## Gotchas

- **Rate limiting** - Handle API errors gracefully
- **Token limits** - Chunk large contexts
- **Streaming** - Use for long responses, update UI progressively
- **State** - Preview vs saved edits have different dirty state handling
- **Config** - User settings in `codex-editor-extension` namespace
