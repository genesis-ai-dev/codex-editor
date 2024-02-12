// import { Key } from "react";

import { VSCodeTextArea } from "@vscode/webview-ui-toolkit/react";
import { FormEventHandler } from "react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ObsStory = Record<string, any>;
// type ObsStory = {
//   id: Key | null | undefined;
//   title: string | undefined;
//   text: string | undefined;
//   end: string | undefined;
// };

const ObsEditorPanel = ({
  obsStory,
  setStory,
}: {
  obsStory: ObsStory[];
  setStory: (story: ObsStory[]) => void;
}) => {
  //   const {
  //     state: { selectedFont, fontSize },
  //     actions: { setSelectedStory },
  //   } = useContext(ReferenceContext);
  //   const {
  //     states: { scrollLock },
  //   } = useContext(ProjectContext);

  const handleChange: ((e: globalThis.Event) => unknown) & FormEventHandler = (
    e
  ) => {
    const index =
      Number((e.target as HTMLElement)?.getAttribute("data-id")) ?? 0;
    const value = (e.target as HTMLInputElement)?.value
      ?.toString()
      .replace(/[\n\r]/gm, "");
    const story = obsStory[index - 1];
    let newStory = {};
    if (Object.prototype.hasOwnProperty.call(story, "title")) {
      newStory = {
        id: story.id,
        title: value,
      };
    } else if (Object.prototype.hasOwnProperty.call(story, "text")) {
      newStory = {
        id: story.id,
        img: story.img,
        text: value,
      };
    } else if (Object.prototype.hasOwnProperty.call(story, "end")) {
      newStory = {
        id: story.id,
        end: value,
      };
    }
    const newObsStory = [...obsStory];
    newObsStory[index - 1] = newStory;
    setStory(newObsStory);
  };

  return (
    <div className="flex gap-2 flex-col w-full">
      {obsStory.map((story, index: number) => (
        <div className="flex items-center w-full">
          {Object.prototype.hasOwnProperty.call(story, "title") && (
            <div className="flex m-4 rounded-md w-full" key={story.id}>
              <VSCodeTextArea
                name={story.title}
                onInput={handleChange}
                // onKeyDown={avoidEnter}
                //   onClick={() =>
                //     setSelectedStory(scrollLock === true ? 0 : story.id)
                //   }
                value={story.title}
                data-id={story.id}
                className="flex-grow text-justify ml-2 p-2 text-xl"
                //   style={{
                //     fontFamily: selectedFont || "sans-serif",
                //     fontSize: `${fontSize}rem`,
                //   }}
              />
            </div>
          )}
          {Object.prototype.hasOwnProperty.call(story, "text") && (
            <div className="flex m-4 rounded-md w-full gap-2" key={story.id}>
              <span className="w-10 h-10 bg-gray-800 rounded-full flex justify-center text-md text-white items-center p-6 ">
                {/* {index
                  .toString()
                  .split("")
                  .map((num) => t(`n-${num}`))} */}

                {index}
              </span>

              {Object.prototype.hasOwnProperty.call(story, "img") && (
                <div className="rounded-md w-2/5" key={story.id}>
                  <img src={story.img} alt={story.title} />
                </div>
              )}

              <VSCodeTextArea
                name={story.text}
                onInput={handleChange}
                value={story.text}
                data-id={story.id}
                className=" text-justify ml-2 text-sm w-full h-[180px]"

                //   onFocus={(e) => handleOnFocus(true, e)}
                //   onBlur={(e) => handleOnFocus(false, e)}
                //   onInput={(e) => handleAutoHeight(e)}
                //   style={{
                //     fontFamily: selectedFont || "sans-serif",
                //     fontSize: `${fontSize}rem`,
                //     lineHeight: fontSize > 1.3 ? 1.5 : "",
                //   }}
              />
            </div>
          )}
          {Object.prototype.hasOwnProperty.call(story, "end") && (
            <div className="flex m-4 rounded-md w-full" key={story.id}>
              <VSCodeTextArea
                name={story.end}
                onInput={handleChange}
                //   onKeyDown={avoidEnter}
                //   onClick={() =>
                //     setSelectedStory(scrollLock === true ? 0 : story.id)
                //   }
                value={story.end}
                data-id={story.id}
                className="flex-grow text-justify ml-2 text-sm h-full"
                //   style={{
                //     fontFamily: selectedFont || "sans-serif",
                //     fontSize: `${fontSize}rem`,
                //     lineHeight: fontSize > 1.3 ? 1.5 : "",
                //   }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
export default ObsEditorPanel;
