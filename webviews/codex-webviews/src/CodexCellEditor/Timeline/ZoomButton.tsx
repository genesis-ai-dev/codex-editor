import React from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";

interface ZoomButtonProps {
    initialZoomLevel: number;
    changeZoomLevel: (zoomLevel: number) => void;
    zoomIn?: boolean;
}

const ZoomButton: React.FC<ZoomButtonProps> = ({
    initialZoomLevel,
    changeZoomLevel,
    zoomIn = true,
}) => {
    const lastClickTime = React.useRef<number>(0);
    const [multiplier, setMultiplier] = React.useState<number>(1.5);

    const handleClick = () => {
        const currentTime = Date.now();
        const timeDiff = currentTime - lastClickTime.current;

        // If clicks are within 500ms, increase the multiplier
        if (timeDiff < 500) {
            setMultiplier((prev) => Math.min(prev * 1.5, 5));
        } else {
            setMultiplier(1.5);
        }

        lastClickTime.current = currentTime;
        console.log({ multiplier, initialZoomLevel });
        const newZoomLevel = zoomIn ? initialZoomLevel * multiplier : initialZoomLevel / multiplier;

        changeZoomLevel(newZoomLevel);
    };

    return (
        <Button
            variant="secondary"
            size="icon"
            className="flex-1 rounded-none"
            onClick={handleClick}
        >
            {zoomIn ? <ZoomIn className="h-4 w-4" /> : <ZoomOut className="h-4 w-4" />}
        </Button>
    );
};

export default ZoomButton;
