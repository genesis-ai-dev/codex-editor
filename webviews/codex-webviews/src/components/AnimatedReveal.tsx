import React from 'react';
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { useHover } from "@uidotdev/usehooks";

interface AnimatedRevealProps {
    button: React.ReactNode;
    content: React.ReactNode;
}

const AnimatedReveal: React.FC<AnimatedRevealProps> = ({ button, content }) => {
    const [hoverRef, isHovered] = useHover();

    return (
        <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            gap: '8px',
            position: 'relative'
        }}>
            <div style={{
                opacity: isHovered ? 1 : 0,
                transform: `translateX(${isHovered ? '0' : '-20px'})`,
                transition: 'all 0.2s ease-in-out',
                visibility: isHovered ? 'visible' : 'hidden',
                display: 'flex',
                alignItems: 'center'
            }}>
                {content}
            </div>
            <div 
                ref={hoverRef}
                style={{ display: 'flex' }}
            >
                {button}
            </div>
        </div>
    );
};

export default AnimatedReveal; 