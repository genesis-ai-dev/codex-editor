import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Label } from "../../components/ui/label";

interface SampleProjectPromptModalProps {
    isOpen: boolean;
    onYes: (dontShowAgain: boolean) => void;
    onNo: (dontShowAgain: boolean) => void;
}

export const SampleProjectPromptModal: React.FC<SampleProjectPromptModalProps> = ({
    isOpen,
    onYes,
    onNo,
}) => {
    const [dontShowAgain, setDontShowAgain] = useState(false);

    // Reset checkbox when modal closes
    useEffect(() => {
        if (!isOpen) {
            setDontShowAgain(false);
        }
    }, [isOpen]);

    const handleYes = () => {
        onYes(dontShowAgain);
    };

    const handleNo = () => {
        onNo(dontShowAgain);
    };

    return (
        <Dialog open={isOpen} onOpenChange={() => {}}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader className="pb-3">
                    <DialogTitle className="text-2xl text-left">Welcome to Codex Editor!</DialogTitle>
                </DialogHeader>

                <div className="flex flex-row gap-1 py-0 px-0 justify-center">
                    <Button
                        onClick={handleYes}
                        size="lg"
                        className="h-auto py-9 px-4 flex-1 max-w-[240px] flex flex-col items-center justify-center gap-1"
                    >
                        <span className="text-xl font-semibold">I am NEW</span>
                        <span className="text-sm">Generate a Sample Project</span>
                    </Button>
                    <Button
                        onClick={handleNo}
                        variant="outline"
                        size="lg"
                        className="h-auto py-9 px-4 flex-1 max-w-[240px] flex flex-col items-center justify-center gap-1"
                    >
                        <span className="text-xl font-semibold">I know what I'm doing</span>
                        <span className="text-sm">Create New Project Manually</span>
                    </Button>
                </div>

                <div className="flex justify-end items-center space-x-2 pt-0">
                    <Checkbox
                        id="dontShowAgain"
                        checked={dontShowAgain}
                        onCheckedChange={(checked) => setDontShowAgain(checked === true)}
                    />
                    <Label
                        htmlFor="dontShowAgain"
                        className="text-sm font-normal cursor-pointer"
                    >
                        Don't show this again
                    </Label>
                </div>
            </DialogContent>
        </Dialog>
    );
};
