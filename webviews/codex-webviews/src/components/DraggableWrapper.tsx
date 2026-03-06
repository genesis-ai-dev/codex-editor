import React from "react";
import { GripVertical } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import type { CodexItem } from "types";

interface DraggableWrapperProps {
    item: CodexItem;
    children: (dragHandle: React.ReactNode) => React.ReactNode;
}

export const DraggableWrapper = ({ item, children }: DraggableWrapperProps) => {
    const controls = useDragControls();

    const handle = (
        <div
            className="drag-handle flex-shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity touch-none"
            onPointerDown={(e) => {
                e.preventDefault();
                controls.start(e);
            }}
        >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
    );

    return (
        <Reorder.Item
            as="div"
            value={item}
            dragListener={false}
            dragControls={controls}
            className="list-none"
            whileDrag={{
                boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                scale: 1.02,
                zIndex: 50,
                borderRadius: "6px",
                backgroundColor: "var(--vscode-list-activeSelectionBackground)",
            }}
        >
            {children(handle)}
        </Reorder.Item>
    );
};
