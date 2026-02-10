import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ProjectCard } from "./ProjectCard";
import { TooltipProvider } from "../../../components/ui/tooltip";

const baseProject: any = {
    name: "Sample",
    path: "/tmp/sample",
    gitOriginUrl: "https://example.com/org/repo.git",
    syncStatus: "downloadedAndSynced",
    mediaStrategy: "auto-download",
};

const noop = () => {};

function renderCard(projectOverrides: Partial<typeof baseProject> = {}, cardProps: any = {}) {
    const project = { ...baseProject, ...projectOverrides } as any;
    const vscode = { postMessage: vi.fn() } as any;
    const expanded = { [project.name]: true } as any; // ensure details are expanded
    render(
        <TooltipProvider>
            <ProjectCard
                project={project}
                onCloneProject={noop as any}
                onOpenProject={noop as any}
                vscode={vscode}
                expandedProjects={expanded}
                setExpandedProjects={() => {}}
                newlyAddedProjects={new Set()}
                statusChangedProjects={new Set()}
                parseProjectUrl={(u: string) => ({ groups: [], cleanName: "", displayUrl: u, uniqueId: "id" }) as any}
                getStatusIcon={() => ({ icon: "", title: "", className: "" })}
                {...cardProps}
            />
        </TooltipProvider>
    );
    return { vscode, project };
}

describe("ProjectCard - Clean Media visibility", () => {
    it("hides Clean Media for auto-download", () => {
        renderCard({ mediaStrategy: "auto-download" });
        const el = screen.queryByText(/Clean Media/i);
        expect(el).toBeNull();
    });

    it("shows Clean Media for stream-and-save", () => {
        renderCard({ mediaStrategy: "stream-and-save" });
        const el = screen.queryByText(/Clean Media/i);
        expect(!!el).toBe(true);
    });

    it("hides Clean Media for stream-only", () => {
        renderCard({ mediaStrategy: "stream-only" });
        const el = screen.queryByText(/Clean Media/i);
        expect(el).toBeNull();
    });
});

describe("ProjectCard - Swap Project functionality", () => {
    it("shows 'Swap Project' button when swap is pending on old project", () => {
        renderCard({
            projectSwap: {
                swapStatus: "active",
                isOldProject: true,
                newProjectName: "new-project",
                newProjectUrl: "https://example.com/org/new-project.git",
                swapEntries: [
                    {
                        swapUUID: "test-uuid",
                        swapStatus: "active",
                        isOldProject: true,
                    },
                ],
            },
        });
        const btn = screen.getByRole("button", { name: /Swap Project/i });
        expect(btn).toBeTruthy();
    });

    it("shows 'Open' button when project is new (isOldProject=false)", () => {
        renderCard({
            projectSwap: {
                swapStatus: "active",
                isOldProject: false, // NEW project
                swapEntries: [
                    {
                        swapUUID: "test-uuid",
                        swapStatus: "active",
                        isOldProject: false,
                    },
                ],
            },
        });
        const btn = screen.getByRole("button", { name: /Open/i });
        expect(btn).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Swap Project/i })).toBeNull();
    });

    it("shows 'Open' button when swap is cancelled", () => {
        renderCard({
            projectSwap: {
                swapStatus: "cancelled",
                isOldProject: true,
                swapEntries: [
                    {
                        swapUUID: "test-uuid",
                        swapStatus: "cancelled",
                        isOldProject: true,
                        cancelledBy: "admin",
                        cancelledAt: Date.now(),
                    },
                ],
            },
        });
        const btn = screen.getByRole("button", { name: /Open/i });
        expect(btn).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Swap Project/i })).toBeNull();
    });

    it("shows new project name subtitle when swap is pending", () => {
        renderCard({
            projectSwap: {
                swapStatus: "active",
                isOldProject: true,
                newProjectName: "new-project-name",
                swapEntries: [
                    {
                        swapUUID: "test-uuid",
                        swapStatus: "active",
                        isOldProject: true,
                    },
                ],
            },
        });
        const subtitle = screen.getByText(/New project: new-project-name/i);
        expect(subtitle).toBeTruthy();
    });

    it("sends correct message when swap button is clicked", () => {
        const { vscode } = renderCard({
            projectSwap: {
                swapStatus: "active",
                isOldProject: true,
                newProjectName: "new-project",
                swapEntries: [
                    {
                        swapUUID: "test-uuid",
                        swapStatus: "active",
                        isOldProject: true,
                    },
                ],
            },
        });

        const btn = screen.getByRole("button", { name: /Swap Project/i });
        fireEvent.click(btn);

        expect(vscode.postMessage).toHaveBeenCalledWith({
            command: "project.performSwap",
            projectPath: "/tmp/sample",
        });
    });
});

describe("ProjectCard - Media strategy locked for swap initiator", () => {
    it("allows media strategy change for non-initiator", () => {
        renderCard(
            {
                projectSwap: {
                    swapStatus: "active",
                    isOldProject: true,
                    swapInitiatedBy: "admin-user",
                    swapEntries: [
                        {
                            swapUUID: "test-uuid",
                            swapStatus: "active",
                            isOldProject: true,
                            swapInitiatedBy: "admin-user",
                        },
                    ],
                },
            },
            { currentUsername: "other-user" } // Different user
        );

        // The media strategy dropdown should be enabled for non-initiator
        const dropdown = screen.getByRole("button", { name: /Auto Download Media/i });
        expect(dropdown.getAttribute("disabled")).toBeNull();
    });

    it("disables media strategy for swap initiator", () => {
        renderCard(
            {
                projectSwap: {
                    swapStatus: "active",
                    isOldProject: true,
                    swapInitiatedBy: "current-user",
                    swapEntries: [
                        {
                            swapUUID: "test-uuid",
                            swapStatus: "active",
                            isOldProject: true,
                            swapInitiatedBy: "current-user",
                        },
                    ],
                },
            },
            { currentUsername: "current-user" } // Same user who initiated
        );

        // The media strategy dropdown should be disabled for initiator
        const dropdown = screen.getByRole("button", { name: /Auto Download Media/i });
        expect(dropdown.hasAttribute("disabled")).toBe(true);
    });
});

describe("ProjectCard - Update required badge", () => {
    it("shows Update required badge when pending update exists", () => {
        renderCard({
            pendingUpdate: {
                required: true,
                reason: "Admin requires update",
            },
        });
        const badge = screen.getByText(/Update required/i);
        expect(badge).toBeTruthy();
    });

    it("shows Update button when pending update exists", () => {
        renderCard({
            pendingUpdate: {
                required: true,
                reason: "Admin requires update",
            },
        });
        const btn = screen.getByRole("button", { name: /Update/i });
        expect(btn).toBeTruthy();
    });

    it("does not show Update badge when no pending update", () => {
        renderCard({});
        expect(screen.queryByText(/Update required/i)).toBeNull();
    });
});
