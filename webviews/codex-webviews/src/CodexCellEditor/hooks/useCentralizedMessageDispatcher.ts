import { useEffect, useRef, useCallback } from 'react';

export type MessageHandler = (event: MessageEvent) => void;

interface MessageDispatcher {
    registerHandler: (id: string, handler: MessageHandler) => void;
    unregisterHandler: (id: string) => void;
}

/**
 * Centralized message dispatcher to replace multiple window.addEventListener("message") calls.
 * This eliminates message fan-out where every component processes every message.
 */
export const useCentralizedMessageDispatcher = (): MessageDispatcher => {
    const handlersRef = useRef<Map<string, MessageHandler>>(new Map());
    const isListenerActiveRef = useRef(false);

    const globalHandler = useCallback((event: MessageEvent) => {
        // Route message to all registered handlers
        handlersRef.current.forEach((handler, id) => {
            try {
                handler(event);
            } catch (error) {
                console.error(`[MessageDispatcher] Error in handler ${id}:`, error);
            }
        });
    }, []);

    const registerHandler = useCallback((id: string, handler: MessageHandler) => {
        handlersRef.current.set(id, handler);

        // Add global listener only when we have the first handler
        if (!isListenerActiveRef.current && handlersRef.current.size === 1) {
            window.addEventListener("message", globalHandler);
            isListenerActiveRef.current = true;
        }
    }, [globalHandler]);

    const unregisterHandler = useCallback((id: string) => {
        handlersRef.current.delete(id);

        // Remove global listener when we have no more handlers
        if (isListenerActiveRef.current && handlersRef.current.size === 0) {
            window.removeEventListener("message", globalHandler);
            isListenerActiveRef.current = false;
        }
    }, [globalHandler]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (isListenerActiveRef.current) {
                window.removeEventListener("message", globalHandler);
                isListenerActiveRef.current = false;
            }
            handlersRef.current.clear();
        };
    }, [globalHandler]);

    return { registerHandler, unregisterHandler };
};

/**
 * Hook for components to register a message handler with the centralized dispatcher
 */
export const useMessageHandler = (
    id: string,
    handler: MessageHandler,
    dependencies: any[] = []
) => {
    const { registerHandler, unregisterHandler } = useCentralizedMessageDispatcher();

    useEffect(() => {
        registerHandler(id, handler);
        return () => unregisterHandler(id);
    }, [id, registerHandler, unregisterHandler, ...dependencies]);
};
