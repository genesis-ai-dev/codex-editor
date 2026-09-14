import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncSettings } from "../SyncSettings";

vi.mock("@uidotdev/usehooks", () => ({
    useNetworkState: () => ({ online: true }),
}));

describe("SyncSettings", () => {
    const onTriggerSync = vi.fn();
    const defaultProps = {
        autoSyncEnabled: true,
        syncDelayMinutes: 5,
        isSyncInProgress: false,
        syncStage: "",
        isImportInProgress: false,
        isFrontierExtensionEnabled: true,
        isAuthenticated: true,
        isGitAvailable: true,
        onToggleAutoSync: vi.fn(),
        onChangeSyncDelay: vi.fn(),
        onTriggerSync,
        onLogin: vi.fn(),
    };

    beforeEach(() => {
        onTriggerSync.mockReset();
    });

    it("disables immediately and ignores repeated clicks while sync status is pending", () => {
        render(<SyncSettings {...defaultProps} />);
        const button = screen.getByRole("button", { name: /sync now/i });

        fireEvent.click(button);
        fireEvent.click(button);

        expect(button).toBeDisabled();
        expect(onTriggerSync).toHaveBeenCalledTimes(1);
    });

    it("re-enables after an acknowledged sync completes", () => {
        const { rerender } = render(<SyncSettings {...defaultProps} />);
        const button = screen.getByRole("button", { name: /sync now/i });

        fireEvent.click(button);
        rerender(<SyncSettings {...defaultProps} isSyncInProgress={true} />);
        rerender(<SyncSettings {...defaultProps} isSyncInProgress={false} />);

        expect(button).not.toBeDisabled();
    });
});
