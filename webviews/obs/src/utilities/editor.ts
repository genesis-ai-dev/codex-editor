export const markdownToStories = (data: string) => {
  const stories: Array<Record<string, unknown>> = [];
  let id = 1;
  let footer = false;
  const allLines = data.split(/\r\n|\n/);
  // Reading line by line
  allLines.forEach((line) => {
    // To avoid the values after footer, we have added id=0
    if (line && id !== 0) {
      if (line.match(/^(\s)*#/gm)) {
        // Fetching the header content
        const hash = line.match(/# (.*)/);
        stories.push({
          id,
          title: hash?.[1],
        });
        id += 1;
      } else if (line.match(/^(\s)*_/gm) || footer === true) {
        // Fetching the footer
        const objIndex = stories.findIndex((obj) => obj.id === id);
        if (
          objIndex !== -1 &&
          Object.prototype.hasOwnProperty.call(stories[objIndex], "img")
        ) {
          stories[objIndex].text = "";
          id += 1;
        }
        if (line.match(/_(.*)_/g) && footer === false) {
          // single line footer
          const underscore = line.match(/_(.*)_/);
          stories.push({
            id,
            end: underscore?.[1],
          });
          // Logically footer is the last line of the story
          id = 0;
        } else {
          // To get multi-line footer (footer=true)
          footer = true;
          if (line.match(/^(\s)*_/gm)) {
            // starting of footer
            const underscore = line.match(/^(\s)*_(.*)/);
            stories.push({
              id,
              end: underscore?.[2],
            });
          } else if (line.match(/_$/gm)) {
            // end of footer
            const underscore = line.match(/(.*)_$/);
            stories[id - 1].end = `${stories[id - 1].end}\n${underscore?.[1]}`;
            // Logically footer is the last line of the story
            id = 0;
          } else {
            // middle lines of footer if available
            stories[id - 1].end = `${stories[id - 1].end}\n${line}`;
          }
        }
      } else if (line.match(/^(\s)*!/gm)) {
        // Fetching the IMG url
        const objIndex = stories.findIndex((obj) => obj.id === id);
        if (
          objIndex !== -1 &&
          Object.prototype.hasOwnProperty.call(stories[objIndex], "img")
        ) {
          stories[objIndex].text = "";
          id += 1;
        }
        const imgUrl = line.match(/\((.*)\)/);
        stories.push({
          id,
          img: imgUrl?.[1],
        });
      } else {
        // Reading the content line by line
        const objIndex = stories.findIndex((obj) => obj.id === id);
        if (objIndex !== -1) {
          // Reading first line after img
          stories[objIndex].text = line;
          id += 1;
        } else {
          // Reading other lines and appending with previous line data
          stories[id - 2].text = `${stories[id - 2]?.text}\n${line}`;
        }
      }
    }
  });
  return stories;
};

// type Story = { title: string; end: string; img: string; text: string };

export const storiesToMarkdown = (stories: Record<string, string>[]) => {
  let title;
  let body = "";
  let end;
  stories.forEach((s) => {
    if (Object.prototype.hasOwnProperty.call(s, "title")) {
      title = `# ${s.title.trim()}\n\n`;
    }
    if (Object.prototype.hasOwnProperty.call(s, "end")) {
      const foot = s.end.trim();
      end = `_${foot}_`;
    }
    if (Object.prototype.hasOwnProperty.call(s, "text")) {
      body += `![OBS Image](${s.img})\n\n${s.text.trim()}\n\n`;
    }
  });
  const storyStr = title + body + end;
  return storyStr;
};
