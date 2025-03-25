import React, { useState } from 'react';
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface AnimatedRevealProps {
    button: React.ReactNode;
    content: React.ReactNode;
}

const AnimatedReveal: React.FC<AnimatedRevealProps> = ({ button, content }) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            gap: '8px',
            position: 'relative'
        }}>
            <div style={{
                opacity: isVisible ? 1 : 0,
                transform: `translateX(${isVisible ? '0' : '-20px'})`,
                transition: 'all 0.3s ease-in-out',
                visibility: isVisible ? 'visible' : 'hidden',
                display: 'flex',
                alignItems: 'center'
            }}>
                {content}
            </div>
            <div 
                onMouseEnter={() => setIsVisible(true)}
                onMouseLeave={() => setIsVisible(false)}
                style={{ display: 'flex' }}
            >
                {button}
            </div>
        </div>
    );
};

export default AnimatedReveal; 