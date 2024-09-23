import React from "react";

// Define an interface for the component's props
interface BadgeProps {
    value: React.ReactNode; // This allows for strings, numbers, and other React nodes
    backgroundColor: string;
}

const Badge: React.FC<BadgeProps> = ({ value, backgroundColor }) => {
    return (
        <span
            className="font-weight-400 d-inline-block color-grey-800 border-radius-sm text-transform-capitalize"
            style={{
                backgroundColor: backgroundColor,
                padding: "2px 6px",
            }}
        >
            {value}
        </span>
    );
};

export default Badge;
