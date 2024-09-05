import ReactQuill, { Quill } from "react-quill";
import "react-quill/dist/quill.snow.css";
import React, { useState, useRef, useEffect } from "react";
// import "./TextEditor.css";
// import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
// import { faUndo, faRedo } from '@fortawesome/free-solid-svg-icons';
// import AiPrompt from './components/aiprompt';
// import { faKeyboard } from '@fortawesome/free-regular-svg-icons';
// import axios from 'axios';
// import { faMicrophone } from '@fortawesome/pro-regular-svg-icons';
// import SpeechRecognition, {
//     useSpeechRecognition,
// } from "react-speech-recognition";
// import { faPenToSquare } from '@fortawesome/pro-regular-svg-icons';
// import Rephraseai from './components/rephraseai';
import registerQuillSpellChecker from "react-quill-spell-checker";
// import { faBook } from '@fortawesome/pro-regular-svg-icons';
// import Modal from 'react-modal';
// import Summarizer from './summarizer';
// import { faQuoteLeft } from '@fortawesome/pro-regular-svg-icons';
// import Citations from './components/citations';
// import { faRobot } from '@fortawesome/pro-regular-svg-icons';
// import Chatbot from './components/chatbot';
// import SignedInNav from './components/signedinnav';
// import { useParams } from 'react-router-dom';
// import { getAuth } from 'firebase/auth';
// import { app } from './index.js';
// import { set } from 'mongoose';

function TextEditor() {
    const quillRef = useRef(null);
    const [menuExpanded, setMenuExpanded] = useState(false);
    const [sidebarContent, setSidebarContent] = useState("");
    const [modalIsOpen, setModalIsOpen] = useState(false);
    // const { projectId } = useParams();
    // const auth = getAuth(app);
    // const user = auth.currentUser.uid;
    const [quillContent, setContent] = useState("");
    const [editorWidth, setEditorWidth] = useState("816px");
    const [editorHeight, setEditorHeight] = useState("975px");
    const [margint, setMargin] = useState("140px");
    const [minHeight1, setMinHeight] = useState("500px");
    const [minWidth1, setMinWidth] = useState("500px");
    const [isLoading, setIsLoading] = useState(false);

    // useEffect(() => {
    //     const handleResize = () => {
    //         if (window.matchMedia("(max-width: 900px)").matches) {
    //             setEditorWidth("100%");
    //             setEditorHeight("80%");
    //             setMinHeight("100%");
    //             setMinWidth("100%");

    //             setMargin("0px");
    //         } else if (window.matchMedia("(min-width: 1800px)").matches) {
    //             setEditorWidth("1316px");
    //             setEditorHeight("1650px");
    //             setMargin("0px");
    //         } else if (window.matchMedia("(min-width: 1200px)").matches) {
    //             setEditorWidth("880px");
    //             setEditorHeight("900px");
    //             setMargin("50px");
    //         } else {
    //             setEditorWidth("880px");
    //             setEditorHeight("900px");
    //             setMinHeight("500px");
    //             setMinWidth("700px");
    //             setMargin("50px");
    //         }
    //     };

    //     window.addEventListener("resize", handleResize);
    //     handleResize();

    //     return () => {
    //         window.removeEventListener("resize", handleResize);
    //     };
    // }, []);

    // useEffect(() => {
    //     const setQuillContent = async () => {
    //         try {
    //             // const response = await axios.get(`${process.env.REACT_APP_BACKEND_URL}/getprojects/${projectId}/${user}`);
    //             const contentString = "test";
    //             let content;
    //             if (contentString) {
    //                 content = JSON.parse(contentString);
    //             } else {
    //                 content = {};
    //             }
    //             if (quillRef.current) {
    //                 quillRef.current.getEditor().setContents(content);
    //             }
    //         } catch (error) {
    //             console.log("error found" + error);
    //         }
    //     };

    //     setQuillContent();
    // }, []);

    // const handleContentChange = () => {
    //     const quill = quillRef.current.getEditor();
    //     const content = quill.getContents();
    //     setContent(content);
    // };

    registerQuillSpellChecker(Quill);
    const editorStyles = {
        height: editorHeight,
        width: editorWidth,
        backgroundColor: "white",
        border: "unset",
        borderRadius: "10px",
        marginTop: margint,
        marginLeft: "auto",
        marginRight: "auto",
        whiteSpace: "pre-wrap",
        marginBottom: "15px",
        minHeight: "900px",
    };

    // useEffect(() => {
    //     // Register custom fonts and sizes
    //     const Font = ReactQuill.Quill.import("formats/font");
    //     Font.whitelist = [
    //         "sans-serif",
    //         "serif",
    //         "monospace",
    //         "georgia",
    //         "comic-sans",
    //         "arial",
    //         "lucida",
    //         "times-new-roman",
    //         "courier-new",
    //         "verdana",
    //     ];
    //     ReactQuill.Quill.register(Font, true);

    //     const Size = ReactQuill.Quill.import("attributors/style/size");
    //     Size.whitelist = [
    //         "10px",
    //         "12px",
    //         "14px",
    //         "16px",
    //         "18px",
    //         "20px",
    //         "24px",
    //         "30px",
    //         "36px",
    //     ];
    //     ReactQuill.Quill.register(Size, true);
    // }, []);

    const modules = {
        toolbar: {
            container: "#toolbar",
        },
        history: {
            delay: 1000,
            maxStack: 50,
            userOnly: true,
        },
        spellChecker: {
            allowIncomplete: true,
            allowCompound: true,
            language: "en",
            autoCheck: true,
        },
    };

    const undo = () => {
        const quill = quillRef.current.getEditor();
        quill.history.undo();
    };

    const redo = () => {
        const quill = quillRef.current.getEditor();
        quill.history.redo();
    };

    const expandMenu = (content) => {
        setMenuExpanded(!menuExpanded);
        setSidebarContent(content);
    };
    // const generateFromAI = async (promptai, size) => {
    //     setIsLoading(true);
    //     try {
    //         console.log(promptai);
    //         console.log(process.env.REACT_APP_BACKEND_URL);
    //         const response = await axios.post(
    //             `${process.env.REACT_APP_BACKEND_URL}/generate-text`,
    //             {
    //                 prompt: promptai,
    //                 size: size,
    //             },
    //         );

    //         if (response.data && response.data.result) {
    //             const editor = quillRef.current.getEditor();
    //             const currentContent = editor.getContents();
    //             const delta = editor.clipboard.convert(response.data.result);
    //             delta.ops.forEach((op) => {
    //                 if (op.insert && typeof op.insert === "string") {
    //                     op.attributes = { background: "yellow" };
    //                 }
    //             });
    //             setIsLoading(false);
    //             editor.setContents(currentContent);
    //             editor.updateContents(delta, "user");

    //             setTimeout(() => {
    //                 const content = editor.getContents();
    //                 content.ops.forEach((op) => {
    //                     if (
    //                         op.attributes &&
    //                         op.attributes.background === "yellow"
    //                     ) {
    //                         delete op.attributes.background;
    //                     }
    //                 });
    //                 editor.setContents(content);
    //             }, 3000);
    //         }
    //     } catch (error) {
    //         console.error("Error generating text:", error);
    //     }
    // };

    // const { transcript, resetTranscript, browserSupportsSpeechRecognition } =
    //     useSpeechRecognition();
    // const lastTranscriptLength = useRef(0);
    // const [isListening, setIsListening] = useState(false);

    // const handleStartListening = () => {
    //     resetTranscript();
    //     SpeechRecognition.startListening({ continuous: true });
    //     setIsListening(true);
    // };

    // const handleStopListening = () => {
    //     SpeechRecognition.stopListening();
    //     setIsListening(false);
    // };
    // useEffect(() => {
    //     if (isListening) {
    //         const newSpeech = transcript
    //             .slice(lastTranscriptLength.current)
    //             .trim()
    //             .replace(/\n/g, " ");

    //         const bufferedSpeech = newSpeech + " ";

    //         if (bufferedSpeech.trim()) {
    //             const quillEditor = quillRef.current.getEditor();
    //             const currentLength = quillEditor.getLength();

    //             quillEditor.insertText(
    //                 currentLength > 0 ? currentLength - 1 : 0,
    //                 bufferedSpeech,
    //             );
    //             quillEditor.setSelection(
    //                 currentLength + bufferedSpeech.length,
    //                 0,
    //             );
    //         }

    //         lastTranscriptLength.current = transcript.length;
    //     }
    // }, [transcript, isListening, quillRef]);

    // useEffect(() => {
    //     const audio = document.getElementById("buttonAudio");
    //     if (isListening) {
    //         audio.play();
    //     }
    // }, [isListening]);

    // if (!browserSupportsSpeechRecognition) {
    //     return <p>Your browser does not support speech recognition.</p>;
    // }

    // const rephraseFromAI = async (tone) => {
    //     setIsLoading(true);
    //     try {
    //         console.log("rephrasing text");
    //         const quillEditor = quillRef.current.getEditor();
    //         quillEditor.focus();
    //         const range = quillEditor.getSelection();

    //         let selectedText = quillEditor.getText(range.index, range.length);
    //         selectedText = selectedText.split(" ").slice(0, 350).join(" ");

    //         if (selectedText.length === 0) {
    //             alert("Please select some text to rephrase.");
    //             return;
    //         }

    //         if (tone === "") {
    //             tone = "neutral";
    //         }

    //         // const response = await axios.post(
    //         //     `${process.env.REACT_APP_BACKEND_URL}/rephrase-text`,
    //         //     {
    //         //         prompt: `Reword the following text with a ${tone} tone keep formatting:  ${selectedText}`,
    //         //     },
    //         // );

    //         if (/* response.data && response.data.result */ true) {
    //             const rephrasedText = "test";
    //             setTimeout(() => {
    //                 setIsLoading(false);
    //             }, 1500);
    //             quillEditor.deleteText(range.index, range.length);
    //             quillEditor.insertText(range.index, rephrasedText);
    //             quillEditor.formatText(
    //                 range.index,
    //                 rephrasedText.length,
    //                 "background",
    //                 "yellow",
    //             );
    //             setTimeout(() => {
    //                 quillEditor.formatText(
    //                     range.index,
    //                     rephrasedText.length,
    //                     "background",
    //                     false,
    //                 );
    //             }, 3000);
    //         }
    //     } catch (error) {
    //         console.error("Error rephrasing text:", error);
    //     }
    // };

    return (
        <div className="editor-page">
            {/* <SignedInNav
                quill={quillRef}
                projectId={projectId}
                quillContent={quillContent}
            /> */}
            <div id="toolbar">
                <span className="ql-formats">
                    <button className="ql-undo" title="Undo" onClick={undo}>
                        ⬅️
                        {/* <FontAwesomeIcon icon={faUndo} /> */}
                    </button>
                    <button className="ql-redo" title="Redo" onClick={redo}>
                        ➡️
                        {/* <FontAwesomeIcon icon={faRedo} /> */}
                    </button>
                    <span className="ql-formats" title="Font Type">
                        <select className="ql-font">
                            <option value="sans-serif">Sans Serif</option>
                            <option value="serif">Serif</option>
                            <option value="monospace">Monospace</option>
                            <option value="georgia">Georgia</option>
                            <option value="comic-sans">Comic Sans</option>
                            <option value="arial">Arial</option>
                            <option value="lucida">Lucida</option>
                            <option value="times-new-roman">
                                Times New Roman
                            </option>
                            <option value="courier-new">Courier New</option>
                            <option value="verdana">Verdana</option>
                        </select>
                    </span>
                </span>
                <span className="ql-formats" title="Font Size">
                    <select className="ql-size" defaultValue="16px">
                        <option value="10px">10px</option>
                        <option value="12px">12px</option>
                        <option value="14px">14px</option>
                        <option value="16px">16px</option>
                        <option value="18px">18px</option>
                        <option value="20px">20px</option>
                        <option value="24px">24px</option>
                        <option value="30px">30px</option>
                        <option value="36px">36px</option>
                    </select>
                </span>
                <span className="ql-formats">
                    <select className="ql-header" title="Header Size">
                        <option value="" selected>
                            Normal
                        </option>
                        <option value="1">Heading 1</option>
                        <option value="2">Heading 2</option>
                        <option value="3">Heading 3</option>
                    </select>
                    <button className="ql-bold" title="Bold"></button>
                    <button className="ql-italic" title="Italic"></button>
                    <button className="ql-underline" title="Underline"></button>
                    <select className="ql-color" title="Text Color"></select>
                    <select
                        className="ql-background"
                        title="Background Color"
                    ></select>
                    <button
                        className="ql-list"
                        value="ordered"
                        title="Ordered List"
                    ></button>
                    <button
                        className="ql-list"
                        value="bullet"
                        title="Bullet List"
                    ></button>
                    <select className="ql-align" title="Text Alignment">
                        <option value="" selected>
                            Align Left
                        </option>
                        <option value="center">Align Center</option>
                        <option value="right">Align Right</option>
                        <option value="justify">Justify</option>
                    </select>
                    <button className="ql-link" title="Insert Link"></button>
                    <button className="ql-image" title="Insert Image"></button>
                    <button
                        className="ql-clean"
                        title="Clear Formatting"
                    ></button>
                </span>
            </div>

            <div
                style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                }}
                className="menu-container"
            >
                <div className={`menu ${menuExpanded ? "menu-expanded" : ""}`}>
                    <div className="icons-wrapper">
                        {/* <FontAwesomeIcon
                            icon={faKeyboard}
                            className="menu-icons"
                            title="Generate AI Text"
                            onClick={() => expandMenu("aiprompt")}
                        />
                        <FontAwesomeIcon
                            icon={faMicrophone}
                            className="menu-icons"
                            title="Dictation"
                            onClick={handleStartListening}
                        />
                        <FontAwesomeIcon
                            icon={faPenToSquare}
                            className="menu-icons"
                            title="Rephraser"
                            onClick={() => expandMenu("rephrase")}
                        />
                        <FontAwesomeIcon
                            icon={faBook}
                            className="menu-icons"
                            title="Summarize"
                            onClick={() => setModalIsOpen(true)}
                        />
                        <FontAwesomeIcon
                            icon={faQuoteLeft}
                            className="menu-icons"
                            title="Citation Generator"
                            onClick={() => expandMenu("citation")}
                        />
                        <FontAwesomeIcon
                            icon={faRobot}
                            className="menu-icons"
                            title="Chatbot"
                            onClick={() => expandMenu("chatbot")}
                        /> */}
                    </div>
                    {sidebarContent === "aiprompt" && menuExpanded && (
                        <div>
                            {/* <button onClick={generateFromAI}>
                                Generate AI Text
                            </button> */}
                            {/* <AiPrompt func={generateFromAI} /> */}
                        </div>
                    )}
                    {sidebarContent === "rephrase" && menuExpanded && (
                        <div>
                            {/* <button onClick={rephraseFromAI}>
                                Rephrase Text
                            </button> */}
                            {/* <Rephraseai func={rephraseFromAI} /> */}
                        </div>
                    )}
                    {sidebarContent === "citation" && menuExpanded && (
                        <div>
                            <button onClick={() => expandMenu("citation")}>
                                Citation Generator
                            </button>
                            {/* <Citations /> */}
                        </div>
                    )}
                    <div
                        className="expand-menu-container"
                        style={{
                            display:
                                sidebarContent === "chatbot" && menuExpanded
                                    ? "block"
                                    : "none",
                        }}
                    >
                        {/* <Chatbot projectId={projectId} /> */}
                    </div>
                </div>

                <ReactQuill
                    ref={quillRef}
                    theme="snow"
                    style={editorStyles}
                    modules={modules}
                    // onChange={handleContentChange}
                />

                {/* {isLoading ? (
                    <iframe
                        className="loading-projects-editor"
                        src="https://lottie.host/embed/ca37b0de-f9e3-4e31-a89c-2675bc850686/RayPTLGoAQ.json"
                    ></iframe>
                ) : null} */}

                {/* <Modal
                    isOpen={modalIsOpen}
                    onRequestClose={() => setModalIsOpen(false)}
                    style={{
                        content: {
                            width: "60%",
                            height: "82%",
                            margin: "auto",
                            marginTop: "70px",
                            border: "unset",
                            borderRadius: "10px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            overflowY: "scroll",
                            minHeight: minHeight1,
                            maxHeight: "800px",
                            maxWidth: "1000px",
                            minWidth: minWidth1,
                        },
                        overlay: {
                            backgroundColor: "rgba(0, 0, 0, 0.5)",
                        },
                    }}
                >
                    <Summarizer />
                </Modal> */}
                {/* 
                <div
                    id="listeningIndicator"
                    className={`listening-indicator ${
                        isListening ? "" : "hidden"
                    }`}
                    onClick={handleStopListening}
                >
                    <button onClick={handleStartListening}>mirophone</button>
                  
                </div>
                <audio
                    id="buttonAudio"
                    src="/assets/bell.wav"
                    preload="auto"
                ></audio> */}
            </div>
        </div>
    );
}

export default TextEditor;
