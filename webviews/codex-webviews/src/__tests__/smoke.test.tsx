import { describe, it, expect } from "vitest";

describe("webviews smoke", () => {
    it("runs vitest and executes a simple truthy assertion", () => {
        expect(1 + 1).toBe(2);
    });
});

