#!/usr/bin/env python3
"""
Check the current status of all external tools used by Codex Editor.

Reports:
  - File system presence of each binary (git, sqlite, ffmpeg, ffprobe)
  - System availability via `which`
  - globalState flags (requiredTools.ffmpeg, requiredTools.ffprobe)

Usage:
  python3 scripts/check_tools_status.py
  python3 scripts/check_tools_status.py --app-name "Codex"       # default
  python3 scripts/check_tools_status.py --app-name "Code"        # regular VS Code
  python3 scripts/check_tools_status.py --app-name "VSCodium"
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

CODEX_EXT_ID = "project-accelerate.codex-editor-extension"
FRONTIER_EXT_ID = "frontier-rnd.frontier-authentication"
DUGITE_TAG = "v2.47.3-1"

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"


def get_global_storage_root(app_name: str) -> Path:
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / app_name / "User" / "globalStorage"
    elif system == "Linux":
        return Path.home() / ".config" / app_name / "User" / "globalStorage"
    elif system == "Windows":
        return Path(os.environ.get("APPDATA", "")) / app_name / "User" / "globalStorage"
    else:
        print(f"Unsupported platform: {system}")
        sys.exit(1)


def check_file_exists(path: Path) -> bool:
    return path.exists() and path.is_file()


def check_system_binary(name: str) -> str | None:
    return shutil.which(name)


def run_version_check(binary_path: str) -> str | None:
    try:
        result = subprocess.run(
            [binary_path, "--version" if "git" in binary_path else "-version"],
            capture_output=True, text=True, timeout=5,
        )
        first_line = result.stdout.strip().split("\n")[0] if result.stdout else None
        return first_line
    except Exception:
        return None


def read_global_state(storage_root: Path, ext_id: str) -> dict:
    db_path = storage_root / "state.vscdb"
    if not db_path.exists():
        return {}
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.execute("SELECT value FROM ItemTable WHERE key = ?", (ext_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return json.loads(row[0])
        return {}
    except Exception as e:
        print(f"  {RED}Error reading state.vscdb: {e}{RESET}")
        return {}


def status_icon(ok: bool) -> str:
    return f"{GREEN}✓{RESET}" if ok else f"{RED}✗{RESET}"


def main():
    parser = argparse.ArgumentParser(description="Check Codex tools status")
    parser.add_argument("--app-name", default="Codex", help="VS Code app name (default: Codex)")
    args = parser.parse_args()

    storage_root = get_global_storage_root(args.app_name)
    codex_storage = storage_root / CODEX_EXT_ID
    frontier_storage = storage_root / FRONTIER_EXT_ID

    print(f"\n{BOLD}=== Codex Tools Status ({args.app_name}) ==={RESET}\n")
    print(f"  Global storage: {storage_root}\n")

    # --- Git ---
    print(f"{BOLD}1. Git (dugite-native){RESET}")
    git_dir = frontier_storage / "git" / DUGITE_TAG
    git_exists = git_dir.exists()
    print(f"   Downloaded dir:  {status_icon(git_exists)} {git_dir}")
    if git_exists:
        git_exec = None
        for candidate in git_dir.rglob("git" if platform.system() != "Windows" else "git.exe"):
            if candidate.is_file():
                git_exec = candidate
                break
        if git_exec:
            version = run_version_check(str(git_exec))
            print(f"   Binary version:  {status_icon(bool(version))} {version or 'could not run'}")
        else:
            print(f"   Binary:          {RED}✗ not found inside {git_dir}{RESET}")

    system_git = check_system_binary("git")
    print(f"   System install:  {status_icon(bool(system_git))} {system_git or 'not found'}")

    # --- SQLite ---
    print(f"\n{BOLD}2. SQLite (node_sqlite3.node){RESET}")
    sqlite_path = codex_storage / "sqlite3-native" / "node_sqlite3.node"
    sqlite_exists = check_file_exists(sqlite_path)
    print(f"   Binary:          {status_icon(sqlite_exists)} {sqlite_path}")
    if sqlite_exists:
        version_file = codex_storage / "sqlite3-native" / "version.txt"
        if version_file.exists():
            print(f"   Version file:    {GREEN}✓{RESET} {version_file.read_text().strip()}")

    # --- FFmpeg ---
    print(f"\n{BOLD}3. FFmpeg{RESET}")
    ffmpeg_name = "ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg"
    ffmpeg_path = codex_storage / "ffmpeg" / ffmpeg_name
    ffmpeg_downloaded = check_file_exists(ffmpeg_path)
    print(f"   Downloaded:      {status_icon(ffmpeg_downloaded)} {ffmpeg_path}")
    if ffmpeg_downloaded:
        version = run_version_check(str(ffmpeg_path))
        print(f"   Version:         {status_icon(bool(version))} {version or 'could not run'}")

    system_ffmpeg = check_system_binary("ffmpeg")
    print(f"   System install:  {status_icon(bool(system_ffmpeg))} {system_ffmpeg or 'not found'}")
    if system_ffmpeg:
        version = run_version_check(system_ffmpeg)
        if version:
            print(f"   System version:  {GREEN}✓{RESET} {version}")

    # --- FFprobe ---
    print(f"\n{BOLD}4. FFprobe{RESET}")
    ffprobe_name = "ffprobe.exe" if platform.system() == "Windows" else "ffprobe"
    ffprobe_path = codex_storage / "ffprobe" / ffprobe_name
    ffprobe_downloaded = check_file_exists(ffprobe_path)
    print(f"   Downloaded:      {status_icon(ffprobe_downloaded)} {ffprobe_path}")
    if ffprobe_downloaded:
        version = run_version_check(str(ffprobe_path))
        print(f"   Version:         {status_icon(bool(version))} {version or 'could not run'}")

    system_ffprobe = check_system_binary("ffprobe")
    print(f"   System install:  {status_icon(bool(system_ffprobe))} {system_ffprobe or 'not found'}")
    if system_ffprobe:
        version = run_version_check(system_ffprobe)
        if version:
            print(f"   System version:  {GREEN}✓{RESET} {version}")

    # --- globalState ---
    print(f"\n{BOLD}5. globalState (requiredTools flags){RESET}")
    state = read_global_state(storage_root, CODEX_EXT_ID)
    ffmpeg_required = state.get("requiredTools.ffmpeg", None)
    ffprobe_required = state.get("requiredTools.ffprobe", None)

    if ffmpeg_required is None and ffprobe_required is None:
        print(f"   requiredTools.ffmpeg:  {YELLOW}not set{RESET} (audio not yet triggered)")
        print(f"   requiredTools.ffprobe: {YELLOW}not set{RESET} (audio not yet triggered)")
    else:
        print(f"   requiredTools.ffmpeg:  {GREEN if ffmpeg_required else YELLOW}{ffmpeg_required}{RESET}")
        print(f"   requiredTools.ffprobe: {GREEN if ffprobe_required else YELLOW}{ffprobe_required}{RESET}")

    all_state_keys = sorted(state.keys())
    if all_state_keys:
        print(f"\n   All globalState keys for {CODEX_EXT_ID}:")
        for key in all_state_keys:
            val = state[key]
            display = json.dumps(val) if not isinstance(val, str) else val
            if len(display) > 80:
                display = display[:77] + "..."
            print(f"     {key}: {display}")

    print()


if __name__ == "__main__":
    main()
