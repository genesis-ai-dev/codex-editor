import * as vscode from "vscode";

type ABTestResultPayload<TVariant> = TVariant[] | { variants: TVariant[]; names?: string[] };
type ABTestHandler<TContext, TVariant> = (context: TContext) => Promise<ABTestResultPayload<TVariant>>;

interface ABTestEntry<TContext, TVariant> {
  name: string;
  probability: number; // 0..1
  handler: ABTestHandler<TContext, TVariant>;
}

class ABTestingRegistry {
  private tests = new Map<string, ABTestEntry<any, any>>();

  register<TContext, TVariant>(
    name: string,
    probability: number,
    handler: ABTestHandler<TContext, TVariant>
  ): void {
    const clamped = Math.max(0, Math.min(1, probability));
    this.tests.set(name, { name, probability: clamped, handler });
  }

  get<TContext, TVariant>(name: string): ABTestEntry<TContext, TVariant> | undefined {
    return this.tests.get(name);
  }

  shouldRun(name: string): boolean {
    const entry = this.tests.get(name);
    if (!entry) return false;
    const rnd = Math.random();
    return rnd < entry.probability;
  }

  async maybeRun<TContext, TVariant>(
    name: string,
    context: TContext
  ): Promise<{ variants: TVariant[]; names?: string[]; testName?: string } | null> {
    const entry = this.tests.get(name) as ABTestEntry<TContext, TVariant> | undefined;
    if (!entry) return null;
    if (!this.shouldRun(name)) return null;
    try {
      const result = await entry.handler(context);
      if (Array.isArray(result)) {
        return { variants: result, testName: entry.name };
      }
      return { ...result, testName: entry.name };
    } catch (err) {
      console.error(`[ABTestingRegistry] Test '${name}' failed`, err);
      return null;
    }
  }
}

export const abTestingRegistry = new ABTestingRegistry();

// Simple helper to log decisions (can be expanded later)
export function logABDecision(name: string, ran: boolean) {
  try {
    const output = vscode.window.createOutputChannel("Codex A/B Testing");
    output.appendLine(`${new Date().toISOString()} - ${name}: ${ran ? "ran" : "skipped"}`);
  } catch {
    // no-op if output channels unavailable
  }
}

export type { ABTestHandler };


