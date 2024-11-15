import { useEffect, useRef } from "react";
import Quill from "quill";

export function useQuillTextExtractor() {
    const quillRef = useRef<Quill | null>(null);

    useEffect(() => {
        // Create a temporary container for Quill
        const tempContainer = document.createElement("div");
        tempContainer.style.display = "none"; // Hide the container
        document.body.appendChild(tempContainer);

        // Initialize Quill in the temporary container
        quillRef.current = new Quill(tempContainer, {
            modules: {
                toolbar: false,
            },
            readOnly: true,
            theme: "snow",
        });

        // Cleanup on unmount
        return () => {
            document.body.removeChild(tempContainer);
            if (quillRef.current) {
                quillRef.current = null;
            }
        };
    }, []); // Empty dependency array ensures this runs once on mount

    function extractTextFromHtml(htmlContent: string): string {
        if (!quillRef.current) {
            return "";
        }

        // Load the HTML content into Quill
        quillRef.current.clipboard.dangerouslyPasteHTML(htmlContent);

        // Extract the text content
        const text = quillRef.current.getText().trim();

        // Clear the Quill contents for next use
        quillRef.current.setContents([]);

        return text;
    }

    return extractTextFromHtml;
}
