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
    }, []);

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

    function addHtmlToText(text: string): string {
        if (!quillRef.current) {
            return text;
        }

        // Clear any existing content
        quillRef.current.setContents([]);

        // Insert the plain text
        quillRef.current.setText(text);

        // Get the resulting HTML with Quill's default formatting
        const html = quillRef.current.root.innerHTML;

        // Clear the editor for next use
        quillRef.current.setContents([]);

        return html;
    }

    return { extractTextFromHtml, addHtmlToText };
}
