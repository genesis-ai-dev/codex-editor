import React, { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { AlertCircle, Trash2 } from "lucide-react";

interface ExistingBible {
    name: string;
    path: string;
    books: number;
    verses: number;
}

interface ExistingBiblesCheckProps {
    onContinue: () => void;
    onCancel: () => void;
}

export const ExistingBiblesCheck: React.FC<ExistingBiblesCheckProps> = ({
    onContinue,
    onCancel,
}) => {
    const [existingBibles, setExistingBibles] = useState<ExistingBible[]>([]);
    const [isChecking, setIsChecking] = useState(true);

    useEffect(() => {
        checkForExistingBibles();
    }, []);

    const checkForExistingBibles = () => {
        setIsChecking(true);

        // Send message to extension to check for existing bibles
        const vscode = (window as any).vscodeApi;

        // Set up listener before sending message
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "existingBiblesFound") {
                setExistingBibles(message.bibles || []);
                setIsChecking(false);
                // Remove listener after receiving response
                window.removeEventListener("message", handleMessage);
            }
        };

        window.addEventListener("message", handleMessage);

        // Send the request
        vscode.postMessage({
            command: "checkExistingBibles",
        });

        // Set a timeout in case we don't get a response
        const timeout = setTimeout(() => {
            console.warn("Timeout waiting for existing bibles check");
            setIsChecking(false);
            window.removeEventListener("message", handleMessage);
        }, 5000);

        // Cleanup function
        return () => {
            clearTimeout(timeout);
            window.removeEventListener("message", handleMessage);
        };
    };

    if (isChecking) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Checking for existing Bibles...</p>
                </div>
            </div>
        );
    }

    if (existingBibles.length === 0) {
        // No existing bibles, proceed directly
        onContinue();
        return null;
    }

    return (
        <div className="space-y-4">
            <Alert
                variant="destructive"
                className="border-yellow-600 bg-yellow-50 dark:bg-yellow-950/20"
            >
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <AlertTitle className="text-yellow-800 dark:text-yellow-200">
                    Existing Bible Found in Project
                </AlertTitle>
                <AlertDescription className="text-yellow-700 dark:text-yellow-300">
                    <p className="mb-4">
                        You already have {existingBibles.length} Bible
                        {existingBibles.length > 1 ? "s" : ""} in your project. To maintain data
                        integrity, we recommend either:
                    </p>
                    <ul className="list-disc list-inside space-y-2 mb-4">
                        <li>Delete the existing Bible(s) first, then import the new one</li>
                        <li>Start a new project for the new Bible translation</li>
                    </ul>

                    <div className="space-y-2">
                        <h4 className="font-semibold">Existing Bibles:</h4>
                        {existingBibles.map((bible, index) => (
                            <div
                                key={index}
                                className="bg-white dark:bg-gray-800 p-3 rounded-md border"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium">{bible.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {bible.books} books, {bible.verses.toLocaleString()}{" "}
                                            verses
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </AlertDescription>
            </Alert>

            <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={onCancel}>
                    Cancel Import
                </Button>
                <Button
                    variant="destructive"
                    onClick={onContinue}
                    className="bg-yellow-600 hover:bg-yellow-700"
                >
                    Continue Anyway
                </Button>
            </div>
        </div>
    );
};
