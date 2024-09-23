export interface HTMLMapContext {
    lastChapter?: number;
}

export interface HTMLMap {
    [key: string]: {
        [key: string]:
            | {
                  tagName: string;
                  classList?: string[];
                  id?: string;
                  attributes?: {
                      [key: string]: boolean;
                  };
              }
            | ((args: { atts?: { number: number } }) => {
                  tagName: string;
                  classList?: string[];
                  id?: string;
                  attributes?: {
                      [key: string]: boolean;
                  };
              });
    };
}

const htmlMap: (context: HTMLMapContext) => HTMLMap = (context) => ({
    "*": {
        "*": {
            tagName: "span",
        },
        sequence: {
            tagName: "section",
        },
    },
    wrapper: {
        "*": {
            tagName: "wrapper",
        },
        sequence: {
            tagName: "section",
        },
    },
    paragraph: {
        "*": {
            tagName: "p",
        },
        "usfm:mt": {
            classList: ["major-title", "paragraph", "mt", "hidden"],
            tagName: "h2",
            attributes: { contenteditable: false },
        },
        "usfm:ms": {
            classList: ["major-section-heading", "paragraph", "ms"],
            tagName: "h3",
            attributes: { contenteditable: false },
        },
    },
    mark: {
        "*": {
            tagName: "span",
        },
        chapter: ({ atts }) => {
            if (atts) {
                context.lastChapter = atts.number;
                return {
                    classList: ["mark", "chapter", `chapter-${atts.number}`],
                    id: `ch-${atts.number}`,
                    tagName: "span",
                };
            }
            return {
                tagName: "span",
            };
        },
        verses: ({ atts }) => ({
            classList: atts ? ["mark", "verse", `verse-${atts.number}`] : undefined,
            id: atts ? `ch${context.lastChapter}v${atts.number}` : undefined,
            tagName: "span",
            attributes: { contenteditable: false },
        }),
    },
    graft: {
        heading: {
            tagName: "div",
        },
        title: {
            tagName: "div",
        },
        introduction: {
            tagName: "div",
        },
    },
});

export default htmlMap({});
