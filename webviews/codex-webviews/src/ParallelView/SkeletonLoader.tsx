import React from "react";
import "./SkeletonLoader.css";

export const SkeletonLoader: React.FC = () => {
    return (
        <div className="skeleton-loader">
            <div className="skeleton-segment thinking-skeleton">
                <div className="skeleton-header"></div>
                <div className="skeleton-line"></div>
                <div className="skeleton-line"></div>
                <div className="skeleton-line"></div>
            </div>
            <div className="skeleton-segment translation-skeleton">
                <div className="skeleton-header"></div>
                <div className="skeleton-paragraph"></div>
            </div>
            <div className="skeleton-segment memories-skeleton">
                <div className="skeleton-header"></div>
                <div className="skeleton-line"></div>
                <div className="skeleton-line"></div>
            </div>
            <div className="skeleton-segment new-memory-skeleton">
                <div className="skeleton-header"></div>
                <div className="skeleton-line"></div>
            </div>
        </div>
    );
};
