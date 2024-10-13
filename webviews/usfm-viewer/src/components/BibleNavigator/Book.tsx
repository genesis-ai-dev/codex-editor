import { ReferenceContext } from "@/context/ReferenceContext";
import { getChapters } from "@/utilities/verseRefUtils/verseData";
import { BookPayload, MessageType } from "types/types";
import { useContext, useEffect } from "react";
import { ChapterExplorer } from "./Chapter";
import { vscode } from "@/utilities/vscode";

export const BookView = ({
    onBookClick,
    bookList,
}: {
    onBookClick: (book: BookPayload) => void;
    bookList: BookPayload[] | undefined;
}) => {
    const {
        state: { selectedBook, showChapterList },
        actions,
    } = useContext(ReferenceContext);
    const { setSelectedBook, setBookChapters, setSelectedChapter, setShowChapterList } = actions;

    const handleSelectChapter = (chapter: string) => {
        console.log({ chapter });
        setSelectedChapter(parseInt(chapter));
        vscode.postMessage({
            type: MessageType.UPDATE_CHAPTER,
            payload: { chapter },
        });
        // console.log({ document });
        // const editor = document.getElementById("bibleRefEditor");
        // console.log({ editor });
        // if (editor) {
        //   const element = editor.querySelector(`[data-chapter="${chapter}"]`);
        //   console.log({ element });
        //   if (element) {
        //     element.scrollIntoView({
        //       behavior: "smooth",
        //       block: "start",
        //       inline: "nearest",
        //     });
        //   }
        // }
    };

    const handleSelectBook = (book: BookPayload) => {
        onBookClick(book);
        setSelectedBook(book.fileName);
        const { chapters } = getChapters(book.book);
        console.log({ chapters });
        setBookChapters(chapters);
        setShowChapterList((prev) => !prev);
    };

    useEffect(() => {
        setShowChapterList(true);
    }, [selectedBook]);
    return (
        <div className="space-y-2">
            <div className="space-y-2 ">
                {bookList &&
                    bookList.length > 0 &&
                    bookList.map((book, index) => (
                        <div key={index}>
                            <div
                                className="cursor-pointer text-left hover:text-blue-500 rounded border border-gray-300 p-2"
                                onClick={() => handleSelectBook(book)}
                            >
                                {book.book}
                            </div>
                            {selectedBook && selectedBook === book.fileName && showChapterList && (
                                <ChapterExplorer onSelectChapter={handleSelectChapter} />
                            )}
                        </div>
                    ))}
            </div>
        </div>
    );
};
