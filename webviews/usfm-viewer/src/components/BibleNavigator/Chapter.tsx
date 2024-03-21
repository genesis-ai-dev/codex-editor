import { useContext } from "react";
import { ReferenceContext } from "@/context/ReferenceContext";

export const ChapterExplorer = ({
  onSelectChapter: handleSelectChapter,
}: {
  onSelectChapter: (chapter: string) => void;
}) => {
  const {
    state: { bookChapters: chapters },
  } = useContext(ReferenceContext);

  return (
    // <div className="grid max-[200px]:grid-cols-3 max-[200px]:grid-cols-4 min-[400px]:grid-cols-6 gap-4 p-2">
    <div className="grid [200px]:grid-cols-3 [400px]:grid-cols-4  gap-4 p-2">
      {chapters.map((chapter, index) => (
        <div key={index}>
          <div
            // key={index}
            className="cursor-pointer hover:text-blue-500"
            onClick={() => handleSelectChapter(chapter)}
          >
            {chapter}
          </div>
        </div>
      ))}
    </div>
  );
};
