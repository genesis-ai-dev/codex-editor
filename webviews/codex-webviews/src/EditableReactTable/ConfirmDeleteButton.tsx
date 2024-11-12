import { Button } from "antd";
import { useState } from "react";
export const ConfirmDeleteButton: React.FC<{ onConfirm: () => void }> = ({ onConfirm }) => {
    const [isDeleting, setIsDeleting] = useState(false);
    if (isDeleting) {
        return (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    flexDirection: "row",
                    flexWrap: "nowrap",
                }}
            >
                <div
                    style={{
                        backgroundColor: "#4caf50",
                        padding: "2px",
                        borderRadius: "4px",
                        display: "inline-block",
                        marginRight: "4px",
                    }}
                >
                    <Button
                        onClick={() => onConfirm()}
                        type="text"
                        icon={<span className="codicon codicon-pass"></span>}
                    />
                </div>
                <div
                    style={{
                        backgroundColor: "#f44336",
                        padding: "2px",
                        borderRadius: "4px",
                        display: "inline-block",
                    }}
                >
                    <Button
                        onClick={() => setIsDeleting(false)}
                        type="text"
                        icon={<span className="codicon codicon-error"></span>}
                    />
                </div>
            </div>
        );
    }
    return (
        <Button
            type="text"
            icon={<span className="codicon codicon-trash"></span>}
            onClick={() => setIsDeleting(true)}
        />
    );
};
