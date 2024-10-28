import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

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
        <VSCodeButton
            style={{
                display: "flex",
                flex: 1,
                borderRadius: 0,
            }}
            appearance="secondary"
            onClick={handleClick}
        >
            <i className={`codicon codicon-zoom-${zoomIn ? "in" : "out"}`}></i>
        </VSCodeButton>
    );
};

export default ZoomButton;
