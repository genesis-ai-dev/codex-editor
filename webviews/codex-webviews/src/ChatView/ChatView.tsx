import { useState, useEffect, useRef } from "react";
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { ChatInputTextForm } from "../components/ChatInputTextForm";
import DeleteButtonWithConfirmation from "../components/DeleteButtonWithConfirmation";
import { WebviewHeader } from "../components/WebviewHeader";
import { MessageItem } from "../components/MessageItem";
import "../App.css";
import { ChatMessageThread, ChatMessageWithContext, ChatPostMessages } from "../../../../types";
import { v4 as uuidv4 } from "uuid";
import { ChatRoleLabel } from "../common";

// const FLASK_ENDPOINT = 'http://localhost:5554';

const vscode = acquireVsCodeApi();

function messageWithContext({
    messageHistory,
    userPrompt,
    selectedText,
    contextItems,
    instructions,
}: {
    messageHistory: string;
    userPrompt?: string;
    selectedText?: string;
    contextItems?: string[];
    instructions?: string;
}): ChatMessageWithContext {
    let content = "## Instructions:\n";
    if (!instructions) {
        content += `Please use the context below to respond to the user's message. If you know the answer, be concise. If the answer is in the context, please quote the wording of the source. If the answer is not in the context, avoid making up anything, but you can use general knowledge from a devout Christian perspective.`;
    } else {
        content += instructions;
    }

    if (selectedText || (contextItems && contextItems?.length > 0)) {
        content += `\n\n### Context:`;
    }

    if (selectedText) {
        content += `\nThe user has most recently selected the following cell to translate. Here is the source text they are translating for context:\n${selectedText}`;
    }

    if (contextItems && contextItems?.length > 0) {
        content += `\n\nAnd here are some other relevant context items from their project and reference resources:\n${contextItems.join(
            "\n"
        )}`;
    }

    if (messageHistory) {
        content += `\n\n### Chat History:\n${messageHistory}`;
    }

    if (userPrompt) {
        content += `\n\n### User's message: ${userPrompt}`;
    }

    return {
        // FIXME: since we're passing in the conversation history, should we be using a completions endpoint rather than a chat one?
        role: "user",
        content: content,
        createdAt: new Date().toISOString(),
    };
}

function App() {
    const [enableGrading, setEnableGrading] = useState<boolean>(false);
    const [pendingMessage, setPendingMessage] = useState<ChatMessageWithContext>();
    const [selectedTextContext, setSelectedTextContext] = useState<string>("");
    const [currentlyActiveCellId, setCurrentlyActiveCellId] = useState<string>("");
    const [contextItems, setContextItems] = useState<string[]>([]); // TODO: we should consolidate various shared state stores into this value
    const [messageLog, setMessageLog] = useState<ChatMessageWithContext[]>([
        // systemMessage,
        // dummyUserMessage,
        // dummyAssistantMessage,
    ]);

    const [currentMessageThreadId, setCurrentMessageThreadId] = useState<string>(uuidv4());

    const [availableMessageThreads, setAvailableMessageThreads] = useState<ChatMessageThread[]>();

    const [sourceCellMap, setSourceCellMap] = useState<{
        [k: string]: { content: string; versions: string[] };
    }>({});

    const SHOW_SENDER_ROLE_LABELS = false;

    function formatMessageLogToString(messages: ChatMessageWithContext[]): string {
        return messages
            .map((message) => {
                return `${ChatRoleLabel[message.role]}: ${message.content}`;
            })
            .join("\n");
    }

    function getResponseToUserNewMessage(newMessageTextContent: string) {
        const contextItemsFromState = contextItems;
        const pendingMessage: ChatMessageWithContext = {
            role: "user",
            content: newMessageTextContent,
            createdAt: new Date().toISOString(),
            context: {
                selectedText: selectedTextContext,
                currentVref: currentlyActiveCellId,
                relevantContextItemsFromEmbeddings: contextItemsFromState,
                // verseNotes: currentVerseNotes,
            },
        };
        const updatedMessageLog = [...messageLog, pendingMessage];

        const formattedPrompt: ChatMessageWithContext[] = [
            messageWithContext({
                messageHistory: formatMessageLogToString(messageLog),
                userPrompt: newMessageTextContent,
                selectedText: selectedTextContext,
                contextItems: contextItemsFromState,
            }),
        ];
        setMessageLog(updatedMessageLog);
        vscode.postMessage({
            command: "fetch",
            messages: JSON.stringify(formattedPrompt),
        } as ChatPostMessages);
    }

    async function handleSubmit(submittedMessageValue: string) {
        try {
            getResponseToUserNewMessage(submittedMessageValue);
            setSelectedTextContext("");
            setCurrentlyActiveCellId("");
        } catch (error) {
            console.error("Failed to fetch context items due to an error:", error);
            vscode.postMessage({
                command: "error",
                message: `Failed to fetch context items. ${JSON.stringify(error)}`,
                messages: [],
            } as unknown as ChatPostMessages);
        }
    }

    function handleSettingsButtonClick() {
        vscode.postMessage({
            command: "openSettings",
        } as ChatPostMessages);
    }

    useEffect(() => {
        // FIXME: add a progress ring while fetching threads
        vscode.postMessage({
            command: "fetchThread",
        } as ChatPostMessages);
    }, []);

    useEffect(() => {
        vscode.postMessage({
            command: "updateMessageThread",
            messages: messageLog,
            threadId: currentMessageThreadId,
        } as ChatPostMessages);
    }, [messageLog.length, currentMessageThreadId, availableMessageThreads, messageLog]);

    useEffect(() => {
        if (
            currentMessageThreadId &&
            availableMessageThreads &&
            availableMessageThreads?.length > 0
        ) {
            setMessageLog(
                availableMessageThreads.find(
                    (messageThread) => messageThread.id === currentMessageThreadId
                )?.messages || []
            );
        }
    }, [currentMessageThreadId, availableMessageThreads]);

    function gradeExists(): boolean {
        //if grading is turned off there isn't a grade.
        if (!enableGrading) {
            return false;
        }
        if (messageLog && messageLog.length > 0) {
            const latestMessage = messageLog[messageLog.length - 1];
            if (latestMessage?.grade !== undefined && latestMessage?.grade !== null) {
                return true;
            }
        }
        return false;
    }
    function getGrade(): number {
        if (messageLog && messageLog.length > 0) {
            const latestMessage = messageLog[messageLog.length - 1];
            if (latestMessage?.grade !== undefined && latestMessage?.grade !== null) {
                return latestMessage.grade;
            }
        }
        return 100;
    }
    function getGradeComment(): string {
        if (messageLog && messageLog.length > 0) {
            const latestMessage = messageLog[messageLog.length - 1];
            return latestMessage.gradeComment ?? "";
        }
        return "";
    }

    const requestGradeDebounceRef = useRef(0);
    useEffect(() => {
        function requestGradeDebounced() {
            if (messageLog.length === 0) {
                return;
            }

            const contextItemsFromState = contextItems;

            const gradeRequestMessage: string =
                "How would a conservative Christian grade the last response of Copilot based on how well it aligns with conservative Christain doctrine.\nTheir grade will be an integer between 0 and 100 where 0 is the lowest grade and 100 is the highest grade.\nInclude what their comment would be for the grade.";

            const messages: ChatMessageWithContext[] = [
                messageWithContext({
                    messageHistory: formatMessageLogToString(messageLog),
                    instructions: gradeRequestMessage,
                    selectedText: selectedTextContext,
                    contextItems: contextItemsFromState,
                }),
            ];

            //send with requestGradeResponse
            vscode.postMessage({
                command: "requestGradeResponse",
                messages: JSON.stringify(messages),
                lastMessageCreatedAt: messageLog[messageLog.length - 1].createdAt,
            } as ChatPostMessages);
        }

        function requestGrade() {
            const GRADE_DEBOUNCE_TIME_MS = 1000;
            clearTimeout(requestGradeDebounceRef.current);

            requestGradeDebounceRef.current = setTimeout(() => {
                requestGradeDebounced();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }, GRADE_DEBOUNCE_TIME_MS) as any;
        }

        function needsGrade(): boolean {
            //if grading is turned off we don't need a grade.
            if (!enableGrading) {
                return false;
            }

            //if the message queue isn't even set we don't need a grade.
            if (!messageLog) {
                return false;
            }

            //If there are no messages we don't need a grade.
            if (messageLog.length === 0) {
                return false;
            }

            const latestMessage = messageLog[messageLog.length - 1];

            //if the laser message isn't a copiolot response
            //we don't need to grade.
            if (latestMessage?.role != "assistant") {
                return false;
            }

            //if the grade already exists we don't need it.
            if (latestMessage?.grade !== undefined && latestMessage?.grade !== null) {
                return false;
            }

            //K, we need a grade.
            return true;
        }

        if (needsGrade()) {
            requestGrade();
        }
    }, [messageLog, messageLog.length, contextItems, selectedTextContext]);

    // FIXME: use loading state to show/hide a progress ring while
    useEffect(() => {
        function handleMessage(event: MessageEvent<ChatPostMessages>) {
            const message = event.data;
            switch (message?.command) {
                case "select":
                    // FIXME: this is being invoked every time a new token is rendered
                    if (message.textDataWithContext) {
                        // FIXME: this needs to use the new codex notebook format
                        const {
                            completeLineContent,
                            selectedText,
                            vrefAtStartOfLine,
                            verseNotes,
                            verseGraphData,
                        } = message.textDataWithContext;

                        const strippedCompleteLineContent = vrefAtStartOfLine
                            ? completeLineContent?.replace(vrefAtStartOfLine, "").trim()
                            : completeLineContent?.trim();

                        const selectedTextContextString =
                            selectedText !== ""
                                ? `${selectedText} (${vrefAtStartOfLine})`
                                : `${strippedCompleteLineContent} (${vrefAtStartOfLine})`;
                        // if (verseNotes !== null) {
                        // setCurrentVerseNotes(verseNotes ?? '');
                        const verseNotesArray =
                            verseNotes?.split("\n\n").filter(
                                // Let's filter out empty notes and notes that are URIs to .json files
                                (note) => note !== "" && !/^[^\n]*\.json$/.test(note) // FIXME: we should simply avoid passing in the URI to the .json file in the first place
                            ) ?? [];

                        verseNotesArray.push(JSON.stringify(verseGraphData)); // Here we're adding the verse graph data to the verse notes array
                        setContextItems(verseNotesArray);
                        // }
                        setSelectedTextContext(selectedTextContextString);
                        setCurrentlyActiveCellId(vrefAtStartOfLine ?? "");
                    }
                    break;
                case "response": {
                    if (!message.finished) {
                        const messageContent =
                            (pendingMessage?.content || "") + (message.text || "");
                        setPendingMessage({
                            role: "assistant",
                            content: messageContent,
                            createdAt: new Date().toISOString(),
                        });
                    } else {
                        if (pendingMessage) {
                            setMessageLog([...messageLog, pendingMessage]);
                        }
                        setPendingMessage(undefined);
                    }
                    break;
                }
                case "respondWithGrade": {
                    try {
                        if (message.content) {
                            //Find the first number on the content and call it the grade.
                            //create regular expression to find first integer.
                            const regex = /\d+/g;
                            const match = regex.exec(message.content);
                            if (match && match.length > 0) {
                                const grade = parseInt(match[0]);

                                //add grade and gradeComment to message in messageLog that
                                //createdAt matches lastMessageCreatedAt

                                let changedSomething = false;
                                const modifiedMessageLog = messageLog.map((m) => {
                                    if (m.createdAt === message?.lastMessageCreatedAt) {
                                        changedSomething = true;
                                        return { ...m, grade, gradeComment: message.content };
                                    }
                                    return m;
                                });

                                if (changedSomething) {
                                    setMessageLog(modifiedMessageLog);
                                }
                            }
                        }
                    } catch (e) {
                        console.log("Error receiving grade", e);
                    }
                    break;
                }
                case "threadsFromWorkspace":
                    if (message.content) {
                        const messageThreadArray = message.content;
                        const lastMessageThreadId =
                            messageThreadArray[messageThreadArray.length - 1]?.id;
                        const messageThreadsExist = !!lastMessageThreadId;
                        if (messageThreadsExist) {
                            setAvailableMessageThreads(
                                messageThreadArray.filter((thread) => !thread.deleted)
                            );
                        }

                        let messageThreadIdToUse: string;

                        if (currentMessageThreadId) {
                            messageThreadIdToUse = currentMessageThreadId;
                        } else if (messageThreadsExist) {
                            messageThreadIdToUse = lastMessageThreadId;
                        } else {
                            messageThreadIdToUse = uuidv4();
                        }

                        setCurrentMessageThreadId(messageThreadIdToUse);

                        const messageThreadForContext = messageThreadArray.find(
                            (thread) => thread.id === messageThreadIdToUse
                        );

                        if (
                            messageThreadForContext?.messages?.length &&
                            messageThreadForContext?.messages?.length > 0
                        ) {
                            setMessageLog(messageThreadForContext.messages);
                        }
                    }
                    break;
                case "updateSetting": {
                    if (message.setting === "enableDoctrineGrading") {
                        setEnableGrading(message.value.toLowerCase().startsWith("t"));
                    }
                    break;
                }
                case "cellIdUpdate":
                    if (message.data) {
                        const { cellId, sourceCellContent } = message.data;
                        setCurrentlyActiveCellId(cellId);
                        setSelectedTextContext(sourceCellContent.content);
                    }
                    break;
                case "updateSourceCellMap":
                    if (message.sourceCellMap) {
                        setSourceCellMap(message.sourceCellMap);
                    }
                    break;
                default:
                    break;
            }
        }

        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [currentMessageThreadId, messageLog, pendingMessage]);

    //Make a useEffect which sends the message "subscribeSettings"
    useEffect(() => {
        vscode.postMessage({
            command: "subscribeSettings",
            settingsToSubscribe: ["enableDoctrineGrading"],
        } as ChatPostMessages);
    }, []);

    function markChatThreadAsDeleted(messageThreadIdToMarkAsDeleted: string) {
        vscode.postMessage({
            command: "deleteThread",
            threadId: messageThreadIdToMarkAsDeleted,
        } as ChatPostMessages);
    }

    function clearChat() {
        setCurrentMessageThreadId(uuidv4());
        setMessageLog([]);
    }

    interface ClearChatButtonProps {
        callback: () => void;
    }

    const DeleteChatButton: React.FC<ClearChatButtonProps> = ({ callback }) => (
        <DeleteButtonWithConfirmation handleDeleteButtonClick={callback} />
    );
    interface NavigateChatHistoryProps {
        callback: (newMessageThreadId: string) => void;
    }
    const NavigateChatHistoryButton: React.FC<NavigateChatHistoryProps> = () => {
        return (
            <>
                <VSCodeButton
                    aria-label="Start New Thread"
                    appearance="icon"
                    title="⨁"
                    onClick={() => {
                        clearChat();
                    }}
                    style={{
                        backgroundColor: "var(--vscode-button-background)",
                        color: "var(--vscode-button-foreground)",
                    }}
                >
                    <i className="codicon codicon-add"></i>
                </VSCodeButton>
                {availableMessageThreads && availableMessageThreads?.length > 0 && (
                    <VSCodeDropdown
                        value={currentMessageThreadId}
                        // disabled={!selectedBook}
                        onInput={(e: any) => {
                            setCurrentMessageThreadId((e.target as HTMLSelectElement).value);
                            vscode.postMessage({
                                command: "fetchThread",
                            } as ChatPostMessages);
                        }}
                    >
                        {availableMessageThreads?.map((messageThread) => {
                            const firstUserMessage = messageThread.messages.find(
                                (message) => message.role === "user"
                            )?.content;

                            return (
                                <VSCodeOption
                                    key={messageThread.id}
                                    selected={messageThread.id === currentMessageThreadId}
                                    value={messageThread.id}
                                >
                                    {messageThread.threadTitle ||
                                        firstUserMessage ||
                                        new Date(messageThread.createdAt).toLocaleTimeString()}
                                </VSCodeOption>
                            );
                        })}
                    </VSCodeDropdown>
                )}
                <VSCodeButton
                    aria-label="Settings"
                    appearance="icon"
                    title="⚙️"
                    onClick={handleSettingsButtonClick}
                    style={{
                        backgroundColor: "var(--vscode-button-background)",
                        color: "var(--vscode-button-foreground)",
                    }}
                >
                    <i className="codicon codicon-settings-gear"></i>
                </VSCodeButton>
            </>
        );
    };

    const onEditComplete = (updatedMessage: ChatMessageWithContext) => {
        //First update the messageLog
        let messageChanged = false;
        const updatedMessageLog = messageLog.map((message) => {
            if (message.createdAt === updatedMessage.createdAt) {
                if (message.content !== updatedMessage.content) {
                    messageChanged = true;
                    return { ...message, content: updatedMessage.content };
                }
            }
            return message;
        });

        //Now also remove the grade on the last message.
        //Removing the grade will make it so that it will get regraded.
        if (updatedMessageLog.length > 0 && messageChanged) {
            updatedMessageLog[updatedMessageLog.length - 1].grade = undefined;
            updatedMessageLog[updatedMessageLog.length - 1].gradeComment = undefined;
        }

        setMessageLog(updatedMessageLog);
    };

    //   const currentMessageThreadTitle = availableMessageThreads?.find(
    //     (messageThread) => messageThread.id === currentMessageThreadId
    //   )?.threadTitle;
    return (
        <main
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                width: "100%",
                backgroundImage:
                    "linear-gradient(45deg, var(--vscode-sideBar-background), transparent)",
                backgroundSize: "cover",
                overflowX: "hidden",
            }}
        >
            <WebviewHeader>
                <div
                    style={{
                        display: "flex",
                        gap: 3,
                        width: "95%",
                    }}
                >
                    <NavigateChatHistoryButton
                        callback={(newMessageThreadId) => {
                            setCurrentMessageThreadId(newMessageThreadId);
                        }}
                    />
                    <DeleteChatButton
                        callback={() => {
                            markChatThreadAsDeleted(currentMessageThreadId);
                            const threadIdThatIsNotBeingDeleted = availableMessageThreads?.find(
                                (thread) => thread.id !== currentMessageThreadId
                            )?.id;
                            if (threadIdThatIsNotBeingDeleted) {
                                setCurrentMessageThreadId(threadIdThatIsNotBeingDeleted);
                            } else {
                                clearChat();
                            }
                        }}
                    />
                </div>
            </WebviewHeader>
            <div
                className="chat-container"
                style={{
                    flex: 1,
                    overflowY: "auto",
                    overflowX: "hidden",
                    gap: "0.5em",
                    flexDirection: "column",
                    padding: "1em",
                    display: "flex",
                    width: "100%",
                    boxSizing: "border-box",
                }}
            >
                {messageLog.map((messageLogItem, index) => (
                    <MessageItem
                        key={index}
                        messageItem={messageLogItem}
                        showSenderRoleLabels={SHOW_SENDER_ROLE_LABELS}
                        onEditComplete={onEditComplete}
                    />
                ))}
                {pendingMessage?.role === "assistant" && pendingMessage?.content.length > 0 ? (
                    <MessageItem messageItem={pendingMessage} />
                ) : null}
            </div>
            {gradeExists() ? (
                <div style={{ padding: "1em", fontWeight: "bold" }}>
                    <div title={getGradeComment()} style={{ cursor: "help" }}>
                        Grade {getGrade()}
                    </div>
                </div>
            ) : null}
            <ChatInputTextForm
                contextItems={contextItems}
                selectedText={selectedTextContext}
                handleSubmit={handleSubmit}
                vscode={vscode}
                sourceCellMap={sourceCellMap}
            />
        </main>
    );
}

export default App;
