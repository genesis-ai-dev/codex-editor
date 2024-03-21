import { useState, createContext,Dispatch, SetStateAction, } from "react";

export interface ReferenceState {
  selectedBook: string;
  bookChapters: string[];
  verseCount: number;
  selectedChapter: number;
  selectedVerse: number;
  showChapterList: boolean;
  showVerseList: boolean;
}

export interface ReferenceActions {
  setSelectedBook: (book: string) => void;
  setBookChapters: (chapters: string[]) => void;
  setVerseCount: (count: number) => void;
  setSelectedChapter: (chapter: number) => void;
  setSelectedVerse: (verse: number) => void;
  setShowChapterList:Dispatch<SetStateAction<boolean>>;
  setShowVerseList: (show: boolean) => void;
}

export interface ReferenceContextType {
  state: ReferenceState;
  actions: ReferenceActions;
}

export const ReferenceContext = createContext<ReferenceContextType>(
  {} as ReferenceContextType
);

export  function ReferenceContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedBook, setSelectedBook] = useState<string>("GEN");
  const [bookChapters, setBookChapters] = useState<string[]>([]);
  const [verseCount, setVerseCount] = useState<number>(0);
  const [selectedChapter, setSelectedChapter] = useState<number>(1);
  const [selectedVerse, setSelectedVerse] = useState<number>(1);
  const [showChapterList, setShowChapterList] = useState<boolean>(false);
  const [showVerseList, setShowVerseList] = useState<boolean>(false);

  const contextValues = {
    state: {
      selectedBook,
      bookChapters,
      verseCount,
      selectedChapter,
      selectedVerse,
      showChapterList,
      showVerseList,
    },
    actions: {
      setSelectedBook,
      setBookChapters,
      setVerseCount,
      setSelectedChapter,
      setSelectedVerse,
      setShowChapterList,
      setShowVerseList,
    },
  };

  return (
    <ReferenceContext.Provider value={contextValues}>
      {children}
    </ReferenceContext.Provider>
  );
}
