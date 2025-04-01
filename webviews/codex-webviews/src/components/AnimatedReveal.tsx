import React, { useEffect, useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { useHover } from "@uidotdev/usehooks";

interface AnimatedRevealProps {
    button: React.ReactNode;
    content: React.ReactNode;
    mode?: "reveal" | "swap";
}

const AnimatedReveal: React.FC<AnimatedRevealProps> = ({ button, content, mode = "reveal" }) => {
    const [wrapperRef, isWrapperHovered] = useHover();
    const [isPopoverHovered, setIsPopoverHovered] = useState(false);

    // Set up listener for validation popover hover
    useEffect(() => {
        const checkPopoverHover = () => {
            const hoveredPopover = document.querySelector(".validation-popover:hover");
            const hoveredPopoverSimpleView = document.querySelector(".validators-simple-view:hover");
            setIsPopoverHovered(!!hoveredPopover || !!hoveredPopoverSimpleView);
        };

        // Add mouse move event listener to detect hover on validation popovers
        document.addEventListener("mousemove", checkPopoverHover);
        
        return () => {
            document.removeEventListener("mousemove", checkPopoverHover);
        };
    }, []);

    // Only show content when wrapper is hovered AND no validation popover is being hovered
    const shouldShowContent = isWrapperHovered && !isPopoverHovered;

    return (
        <div
            ref={wrapperRef}
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                position: "relative",
            }}
        >
            {mode === "reveal" ? (
                <>
                    <div
                        style={{
                            opacity: shouldShowContent ? 1 : 0,
                            transform: `translateX(${shouldShowContent ? "0" : "20px"}) scale(${
                                shouldShowContent ? 1 : 0
                            })`,
                            transition:
                                "all 0.2s ease-in-out, transform 0.2s cubic-bezier(.68,-0.75,.27,1.75)",
                            visibility: shouldShowContent ? "visible" : "hidden",
                            display: "flex",
                            alignItems: "center",
                        }}
                    >
                        {content}
                    </div>
                    <div style={{ display: "flex" }}>{button}</div>
                </>
            ) : (
                <div
                    style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "center"
                    }}
                >
                    <div 
                        style={{ 
                            opacity: isWrapperHovered ? 0 : 1,
                            position: isWrapperHovered ? "absolute" : "relative",
                            visibility: isWrapperHovered ? "hidden" : "visible",
                        }}
                    >
                        {button}
                    </div>
                    <div 
                        style={{ 
                            opacity: isWrapperHovered ? 1 : 0,
                            position: isWrapperHovered ? "relative" : "absolute",
                            visibility: isWrapperHovered ? "visible" : "hidden",
                        }}
                    >
                        {content}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AnimatedReveal;
