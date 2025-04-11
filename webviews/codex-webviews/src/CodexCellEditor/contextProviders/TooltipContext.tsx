import React, { createContext, useState, useContext, ReactNode } from "react";
import TooltipPortal from "../../components/TooltipPortal";

interface TooltipContextType {
    showTooltip: (content: ReactNode, x: number, y: number) => void;
    hideTooltip: () => void;
}

const TooltipContext = createContext<TooltipContextType>({
    showTooltip: () => {},
    hideTooltip: () => {},
});

export const useTooltip = () => useContext(TooltipContext);

interface TooltipProviderProps {
    children: ReactNode;
}

export const TooltipProvider: React.FC<TooltipProviderProps> = ({ children }) => {
    const [tooltipState, setTooltipState] = useState({
        content: null as ReactNode,
        isVisible: false,
        position: { x: 0, y: 0 },
    });

    const showTooltip = (content: ReactNode, x: number, y: number) => {
        setTooltipState({
            content,
            isVisible: true,
            position: { x, y },
        });
    };

    const hideTooltip = () => {
        setTooltipState((prev) => ({
            ...prev,
            isVisible: false,
        }));
    };

    return (
        <TooltipContext.Provider value={{ showTooltip, hideTooltip }}>
            {children}
            <TooltipPortal
                content={tooltipState.content}
                isVisible={tooltipState.isVisible}
                position={tooltipState.position}
            />
        </TooltipContext.Provider>
    );
};

export default TooltipContext;
