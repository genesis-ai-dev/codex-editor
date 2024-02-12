export default function JsonToMd(story: Record<string, any>, imageUrl: string) {
    const title = `# ${story.title}\n\n`;
    const end = `_${story.end}_`;
    const body = (story.story as any[]).reduce(
        (str, value) => `${str}![OBS Image](${value.url})\n\n${value.text}\n\n`,
        "",
    );
    const storyStr = title + body + end;
    return imageUrl !== ""
        ? storyStr.replace(
              /https:\/\/cdn\.door43\.org\/obs\/jpg\/360px\//g,
              imageUrl,
          )
        : storyStr;
}
