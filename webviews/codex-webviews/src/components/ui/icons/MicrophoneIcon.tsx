import React from "react";

interface MicrophoneIconProps {
    width?: number | string;
    height?: number | string;
    className?: string;
    title?: string;
}

const MicrophoneIcon: React.FC<MicrophoneIconProps> = ({
    width = 14,
    height = 14,
    className,
    title,
}) => {
    return (
        <svg
            viewBox="0 0 64 64"
            width={width}
            height={height}
            aria-hidden={title ? undefined : true}
            aria-label={title}
            className={className}
        >
            {title ? <title>{title}</title> : null}
            <path
                fill="currentColor"
                d="M32,44c6.629,0,12-5.371,12-12V12c0-6.629-5.371-12-12-12S20,5.371,20,12v20C20,38.629,25.371,44,32,44z"
            />
            <path
                fill="currentColor"
                d="M52,28c-2.211,0-4,1.789-4,4c0,8.836-7.164,16-16,16s-16-7.164-16-16c0-2.211-1.789-4-4-4s-4,1.789-4,4
                    c0,11.887,8.656,21.73,20,23.641V60c0,2.211,1.789,4,4,4s4-1.789,4-4v-4.359C47.344,53.73,56,43.887,56,32
                    C56,29.789,54.211,28,52,28z"
            />
        </svg>
    );
};

export default MicrophoneIcon;
