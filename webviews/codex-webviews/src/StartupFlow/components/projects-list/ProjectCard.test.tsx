import { render, screen } from "@testing-library/react";
import React from "react";
import { ProjectCard } from "./ProjectCard";

const baseProject: any = {
    name: "Sample",
    path: "/tmp/sample",
    gitOriginUrl: "https://example.com/org/repo.git",
    syncStatus: "downloadedAndSynced",
    mediaStrategy: "auto-download",
};

const noop = () => {};

describe("ProjectCard - Clean Media visibility", () => {
    function renderCard(projectOverrides: Partial<typeof baseProject> = {}) {
        const project = { ...baseProject, ...projectOverrides } as any;
        const vscode = { postMessage: vi.fn() } as any;
        const expanded = { [project.name]: true } as any; // ensure details are expanded
        render(
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
                isProgressDataLoaded={true}
            />
        );
        return { vscode };
    }

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
