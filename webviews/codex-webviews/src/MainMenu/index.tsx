import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import "../tailwind.css";

// Declare the acquireVsCodeApi function and acquire the VS Code API
declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

interface MenuButton {
    id: string;
    label: string;
    icon: string;
    viewId?: string;
    command?: string;
    description?: string;
}

interface MenuSection {
    title: string;
    buttons: MenuButton[];
}

interface State {
    menuConfig: MenuSection[];
    activeViewId: string | null;
}

function MainMenu() {
    const [state, setState] = useState<State>({
        menuConfig: [],
        activeViewId: null,
    });

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case "updateMenu":
                    setState((prevState) => ({
                        ...prevState,
                        menuConfig: message.menuConfig,
                    }));
                    break;
                case "setActiveView":
                    setState((prevState) => ({
                        ...prevState,
                        activeViewId: message.viewId,
                    }));
                    break;
            }
        };

        window.addEventListener("message", handleMessage);

        // Use the globally available vscode object
        try {
            vscode.postMessage({ command: "webviewReady" });
        } catch (error) {
            console.error("Could not send webviewReady message:", error);
        }

        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const focusView = (viewId: string) => {
        setState((prevState) => ({
            ...prevState,
            activeViewId: viewId,
        }));

        try {
            vscode.postMessage({
                command: "focusView",
                viewId: viewId,
            });
        } catch (error) {
            console.error("Could not focus view:", viewId, error);
        }
    };

    const executeCommand = (commandName: string) => {
        try {
            vscode.postMessage({
                command: "executeCommand",
                commandName: commandName,
            });
        } catch (error) {
            console.error("Could not execute command:", commandName, error);
        }
    };

    const handleButtonClick = (button: MenuButton) => {
        if (button.viewId) {
            focusView(button.viewId);
        } else if (button.command) {
            executeCommand(button.command);
        }
    };

    return (
        <div className="container mx-auto p-6 h-screen overflow-auto flex flex-col gap-6 max-w-4xl">
            {state.menuConfig.map((section, index) => (
                <div key={section.title} className="space-y-4">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            {section.title}
                        </h2>
                        <Badge variant="outline" className="text-xs">
                            {section.buttons.length}
                        </Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {section.buttons.map((button) => (
                            <button
                                key={button.id}
                                onClick={() => handleButtonClick(button)}
                                className={`group relative p-4 rounded-lg border transition-all duration-200 text-left hover:shadow-sm ${
                                    button.viewId && state.activeViewId === button.viewId
                                        ? "border-primary bg-primary/5 shadow-sm"
                                        : "border-border hover:border-primary/50 hover:bg-accent/50"
                                }`}
                                title={button.description || ""}
                            >
                                {button.viewId && state.activeViewId === button.viewId && (
                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-sm" />
                                )}

                                <div className="flex items-start gap-3">
                                    <div
                                        className={`flex items-center justify-center w-10 h-10 rounded-md transition-colors ${
                                            button.viewId && state.activeViewId === button.viewId
                                                ? "bg-primary text-primary-foreground"
                                                : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                                        }`}
                                    >
                                        <i className={`codicon codicon-${button.icon} text-base`} />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <h3
                                            className={`font-medium text-sm leading-tight ${
                                                button.viewId && state.activeViewId === button.viewId
                                                    ? "text-primary"
                                                    : "text-foreground group-hover:text-primary"
                                            }`}
                                        >
                                            {button.label}
                                        </h3>
                                        {button.description && (
                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                {button.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            ))}

            <div className="mt-auto pt-6 text-center border-t border-border">
                <Badge variant="secondary" className="text-xs opacity-70">
                    Codex Translation Editor v0.3.12
                </Badge>
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<MainMenu />);
