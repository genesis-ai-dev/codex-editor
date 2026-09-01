import zipfile
import re
from pathlib import Path

FILES = [
    Path(r"C:\Users\marti\Desktop\FrontierRnD\Test Files\Biblica Global Publishing\English IDML\JOB-SNG.idml"),
    Path(r"C:\Users\marti\Desktop\FrontierRnD\Test Files\Biblica Global Publishing\BIBLE Files\Codex May 2026 - Bible Text Files\Portuguese Full Bible\18JOB-22SNG_porNVI23-FB-STD#2.idml"),
    Path(r"C:\Users\marti\Desktop\FrontierRnD\Test Files\Biblica Global Publishing\BIBLE Files\Codex May 2026 - Bible Text Files\French Full Bible\freBDS15u24-STD-FB_20240717_Packaged\18JOB-22SNG_freBDS15u24-STD-FB.idml"),
    Path(r"C:\Users\marti\Desktop\FrontierRnD\Test Files\Biblica Global Publishing\BIBLE Files\Codex May 2026 - Bible Text Files\Russian Full Bible\rusNRT23-FB_lux#2_EastCanon Folder\18JOB-22SNG_rusNRT23-FB_lux#2.idml"),
]

PSR_OPEN = "<ParagraphStyleRange"
PSR_CLOSE = "</ParagraphStyleRange>"


def read_main_story(path: Path) -> str:
    with zipfile.ZipFile(path) as z:
        stories = [(n, z.getinfo(n).file_size) for n in z.namelist() if n.startswith("Stories/") and n.endswith(".xml")]
        name = max(stories, key=lambda x: x[1])[0]
        return z.read(name).decode("utf-8")


def para_style(open_tag: str) -> str:
    m = re.search(r'AppliedParagraphStyle="([^"]+)"', open_tag)
    return m.group(1) if m else ""


def classify_style(style: str) -> str:
    s = style.replace("ParagraphStyle/", "")
    if "meta%3abk" in s or "meta:bk" in s:
        return "book"
    if s.startswith("intro%3a") or s.startswith("intro:"):
        return "intro"
    if s.startswith("head%3a") or s.startswith("head:"):
        return "head"
    if s.startswith("title%3a") or s.startswith("title:"):
        return "title"
    if s.startswith("notes%3a") or s.startswith("notes:"):
        return "notes"
    if s.startswith("text%3a") or s in ("b", "b_poetry", "b_embed", "b_list", "b_pc"):
        return "text"
    return "other"


def iter_psrs(xml: str):
    i = 0
    while i < len(xml):
        start = xml.find(PSR_OPEN, i)
        if start == -1:
            break
        open_end = xml.find(">", start)
        if open_end == -1:
            break
        depth = 1
        scan = open_end + 1
        while depth > 0 and scan < len(xml):
            nxt_open = xml.find(PSR_OPEN, scan)
            nxt_close = xml.find(PSR_CLOSE, scan)
            if nxt_close == -1:
                break
            if nxt_open != -1 and nxt_open < nxt_close:
                depth += 1
                scan = xml.find(">", nxt_open) + 1
            else:
                depth -= 1
                if depth == 0:
                    end = nxt_close + len(PSR_CLOSE)
                    yield start, end, xml[start:open_end + 1]
                    i = end
                    break
                scan = nxt_close + len(PSR_CLOSE)


def analyze(path: Path):
    xml = read_main_story(path)
    print("===", path.name, "size", len(xml), "===")
    current_book = ""
    blocks = []
    block_start = None
    block_styles = []
    for start, end, open_tag in iter_psrs(xml):
        style = para_style(open_tag)
        kind = classify_style(style)
        has_meta_c = "meta%3ac" in open_tag or bool(re.search(r"CharacterStyle/meta%3ac", xml[start:end]))
        has_meta_v = "meta%3av" in xml[start:end]
        if kind == "book":
            if block_start is not None:
                blocks.append((current_book, block_start, prev_end, block_styles))
            raw = re.search(r"<Content>([^<]+)</Content>", xml[start:end])
            current_book = raw.group(1).strip() if raw else current_book
            block_start = None
            block_styles = []
        elif kind == "text" and has_meta_v:
            if block_start is None:
                block_start = start
            block_styles.append(style.split("/")[-1][:30])
        elif kind in ("intro", "notes") and block_start is not None:
            blocks.append((current_book, block_start, start, block_styles))
            block_start = None
            block_styles = []
        prev_end = end

    # sample blocks for JOB and PSA
    for book in ("JOB", "PSA"):
        book_blocks = [b for b in blocks if b[0] == book]
        print(f"  {book}: {len(book_blocks)} text blocks")
        for i, (bk, s, e, styles) in enumerate(book_blocks[:3]):
            print(f"    block{i+1}: {e-s} bytes, {len(styles)} paras, styles={styles[:5]}")
    print()


if __name__ == "__main__":
    for f in FILES:
        if f.exists():
            analyze(f)
        else:
            print("MISSING", f)
