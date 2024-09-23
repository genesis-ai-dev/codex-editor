import React, { useEffect, useState } from "react";
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import bibleBooksLookup from "../assets/bible-books-lookup.json";

interface VerseRefNavigationProps {
    verseRef: string; // Expected format: "Book Chapter:Verse"
    callback: (updatedVerseRef: string) => void;
}

const VerseRefNavigation: React.FC<VerseRefNavigationProps> = ({ verseRef, callback }) => {
    // Split the verseRef into book, chapter, and verse
    const [book, chapterAndVerse] = verseRef.split(" ");
    const [chapter, verse] = chapterAndVerse.split(":");
    useEffect(() => {
        setSelectedBook(book);
        setSelectedChapter(chapter);
        setSelectedVerse(verse);
    }, [verseRef]);

    const [selectedBook, setSelectedBook] = useState<string | undefined>(book);
    const [selectedChapter, setSelectedChapter] = useState<string | undefined>(chapter);
    const [selectedVerse, setSelectedVerse] = useState<string | undefined>(verse);

    const booksOfTheBible = bibleBooksLookup.map((book) => book.abbr);
    const bookData = bibleBooksLookup.find((b) => b.abbr === selectedBook);
    const chaptersBasedOnBook = bookData ? Object.keys(bookData.chapters).map(Number) : [];

    // @ts-expect-error Selected chapter will always match the chapter data
    const verserInChapter = bookData.chapters[selectedChapter];
    const versesBasedOnChapter =
        bookData && verserInChapter ? Array.from({ length: verserInChapter }, (_, i) => i + 1) : [];

    useEffect(() => {
        if (selectedBook && selectedChapter && selectedVerse) {
            const newVerseRef = `${selectedBook} ${selectedChapter}:${selectedVerse}`;
            console.log({ newVerseRef });
            callback(newVerseRef);
        }
    }, [selectedVerse, selectedBook, selectedChapter, callback]);

    return (
        <div
            className="navigation-bar"
            style={{
                display: "flex",
                flexFlow: "row wrap",
                padding: "0.25em",
                gap: "0.25em",
                alignItems: "center",
            }}
        >
            <VSCodeDropdown
                value={selectedBook}
                style={{ minWidth: "max-content" }}
                onInput={(e: any) => {
                    console.log({ e });
                    console.log((e.target as HTMLSelectElement).value);
                    setSelectedBook((e.target as HTMLSelectElement).value);
                    setSelectedChapter("1");
                    setSelectedVerse("1");
                }}
            >
                {booksOfTheBible.map((bibleBook: string) => (
                    <VSCodeOption key={bibleBook} value={bibleBook}>
                        {bibleBook}
                    </VSCodeOption>
                ))}
            </VSCodeDropdown>
            <VSCodeDropdown
                value={selectedChapter}
                style={{ minWidth: "max-content" }}
                disabled={!selectedBook}
                onInput={(e: any) => {
                    console.log({ e });
                    console.log((e.target as HTMLSelectElement).value);
                    setSelectedChapter((e.target as HTMLSelectElement).value);
                    setSelectedVerse("1");
                }}
            >
                {chaptersBasedOnBook.map((chapterNumber) => (
                    <VSCodeOption key={chapterNumber} selected={`${chapterNumber}` === chapter}>
                        {chapterNumber}
                    </VSCodeOption>
                ))}
            </VSCodeDropdown>
            <VSCodeDropdown
                value={selectedVerse}
                style={{ minWidth: "max-content" }}
                disabled={!selectedChapter}
                onInput={(e: any) => {
                    console.log({ e });
                    setSelectedVerse((e.target as HTMLSelectElement).value);
                }}
            >
                {versesBasedOnChapter.map((verseNumber) => (
                    <VSCodeOption key={verseNumber} selected={`${verseNumber}` === verse}>
                        {verseNumber}
                    </VSCodeOption>
                ))}
            </VSCodeDropdown>
        </div>
    );
};

export default VerseRefNavigation;
