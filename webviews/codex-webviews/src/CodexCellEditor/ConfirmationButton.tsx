import React, { useState } from "react";
import { Button } from "../components/ui/button";
import { Check, X, Trash2 } from "lucide-react";

interface ConfirmationButtonProps {
    onClick: () => void;
    disabled?: boolean;
    icon: string;
}

const ConfirmationButton: React.FC<ConfirmationButtonProps> = ({
    onClick,
    disabled = false,
    icon,
}) => {
    const [showConfirmation, setShowConfirmation] = useState(false);

    const handleInitialClick = () => {
        setShowConfirmation(true);
    };

    const handleConfirm = () => {
        onClick();
        setShowConfirmation(false);
    };

    const handleCancel = () => {
        setShowConfirmation(false);
    };

    const getIcon = () => {
        switch (icon) {
            case "trash":
                return <Trash2 className="h-4 w-4" />;
            default:
                return <Trash2 className="h-4 w-4" />;
        }
    };

    if (showConfirmation) {
        return (
            <div className="flex gap-1 border border-border rounded-md p-0.5">
                <Button
                    onClick={handleConfirm}
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-green-600 hover:text-green-700"
                >
                    <Check className="h-4 w-4" />
                </Button>
                <Button
                    onClick={handleCancel}
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-red-600 hover:text-red-700"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
        );
    }

    return (
        <Button
            onClick={handleInitialClick}
            disabled={disabled}
            variant="ghost"
            size="icon"
            title="Delete"
        >
            {getIcon()}
        </Button>
    );
};

export default ConfirmationButton;
