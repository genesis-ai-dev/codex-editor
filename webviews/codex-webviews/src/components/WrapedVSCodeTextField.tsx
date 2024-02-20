import React from "react";
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";

// @ts-expect-error ignore this
export const WrappedVSCodeTextField: typeof VSCodeTextField = ({
    // @ts-expect-error ignore this
    value,
    ...rest
}) => {
    if (value) {
        return <VSCodeTextField value={value} {...rest} />;
    }

    return <VSCodeTextField {...rest} />;
};
