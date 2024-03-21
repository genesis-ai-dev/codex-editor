import React, { useEffect } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vscode } from "../utilities/vscode";

const queryClient = new QueryClient();
const Providers = ({
  children,
}: {
  children: React.ReactNode | React.ReactNode[];
}) => {
  useEffect(() => {
    vscode.setMessageListeners((e) => {
      console.log("providers:", e);
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

export default Providers;
