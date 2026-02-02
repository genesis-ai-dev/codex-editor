type ABTestResultPayload<TVariant> = TVariant[] | {
  variants: TVariant[];
  isAttentionCheck?: boolean;
  correctIndex?: number;
  decoyCellId?: string;
};
type ABTestHandler<TContext, TVariant> = (context: TContext) => Promise<ABTestResultPayload<TVariant> | null>;

interface ABTestEntry<TContext, TVariant> {
  name: string;
  handler: ABTestHandler<TContext, TVariant>;
}

class ABTestingRegistry {
  private tests = new Map<string, ABTestEntry<unknown, unknown>>();

  register<TContext, TVariant>(
    name: string,
    handler: ABTestHandler<TContext, TVariant>
  ): void {
    this.tests.set(name, { name, handler: handler as ABTestHandler<unknown, unknown> });
  }

  has(name: string): boolean {
    return this.tests.has(name);
  }

  async run<TContext, TVariant>(
    name: string,
    context: TContext
  ): Promise<{
    variants: TVariant[];
    testName?: string;
    isAttentionCheck?: boolean;
    correctIndex?: number;
    decoyCellId?: string;
  } | null> {
    const entry = this.tests.get(name);
    if (!entry) return null;
    try {
      const result = await (entry.handler as ABTestHandler<TContext, TVariant>)(context);
      if (!result) return null;
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
export type { ABTestHandler };

