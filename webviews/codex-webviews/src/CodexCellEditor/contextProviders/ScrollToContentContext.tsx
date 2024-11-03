import React from "react";

interface ScrollToContentContextProps {
    contentToScrollTo: string | null;
    setContentToScrollTo: React.Dispatch<React.SetStateAction<string | null>>;
}

const ScrollToContentContext = React.createContext<ScrollToContentContextProps>({
    contentToScrollTo: null,
    setContentToScrollTo: () => {},
});

export default ScrollToContentContext;
