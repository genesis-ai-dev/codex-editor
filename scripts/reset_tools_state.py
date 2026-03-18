#!/usr/bin/env python3
"""
Reset globalState flags for Codex Editor's missing-tools system.

By default, clears the requiredTools.ffmpeg and requiredTools.ffprobe keys.
Optionally deletes the downloaded binaries themselves so you can test
first-download flows.

⚠️  Close VS Code / Codex app before running this script.
    VS Code caches globalState in memory and writes on shutdown,
    so changes made while it's running will be overwritten.

Usage:
  python3 scripts/reset_tools_state.py                          # clear flags only
  python3 scripts/reset_tools_state.py --delete-ffmpeg          # also delete downloaded ffmpeg
  python3 scripts/reset_tools_state.py --delete-ffprobe         # also delete downloaded ffprobe
  python3 scripts/reset_tools_state.py --delete-sqlite          # also delete downloaded sqlite
  python3 scripts/reset_tools_state.py --delete-git             # also delete downloaded git
  python3 scripts/reset_tools_state.py --delete-all             # delete everything + clear flags
  python3 scripts/reset_tools_state.py --app-name "Code"        # target regular VS Code
  python3 scripts/reset_tools_state.py --dry-run                # show what would happen
"""

import argparse
import json
import os
import platform
import shutil
import sqlite3
import sys
from pathlib import Path

CODEX_EXT_ID = "project-accelerate.codex-editor-extension"
FRONTIER_EXT_ID = "frontier-rnd.frontier-authentication"
DUGITE_TAG = "v2.47.3-1"

GLOBALSTATE_KEYS_TO_CLEAR = [
    "requiredTools.ffmpeg",
    "requiredTools.ffprobe",
]

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


def clear_global_state_keys(storage_root: Path, dry_run: bool) -> None:
    db_path = storage_root / "state.vscdb"
    if not db_path.exists():
        print(f"  {YELLOW}state.vscdb not found at {db_path}{RESET}")
        return

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.execute("SELECT value FROM ItemTable WHERE key = ?", (CODEX_EXT_ID,))
        row = cursor.fetchone()

        if not row:
            print(f"  {YELLOW}No globalState found for {CODEX_EXT_ID}{RESET}")
            conn.close()
            return

        state = json.loads(row[0])
        changed = False
        for key in GLOBALSTATE_KEYS_TO_CLEAR:
            if key in state:
                print(f"  {GREEN}Clearing{RESET} {key} (was: {state[key]})")
                del state[key]
                changed = True
            else:
                print(f"  {YELLOW}{key} not set — nothing to clear{RESET}")

        if changed and not dry_run:
            conn.execute(
                "UPDATE ItemTable SET value = ? WHERE key = ?",
                (json.dumps(state), CODEX_EXT_ID),
            )
            conn.commit()
            print(f"  {GREEN}globalState updated successfully{RESET}")
        elif changed:
            print(f"  {YELLOW}[DRY RUN] Would update globalState{RESET}")

        conn.close()
    except Exception as e:
        print(f"  {RED}Error updating state.vscdb: {e}{RESET}")


def delete_directory(dir_path: Path, label: str, dry_run: bool) -> None:
    if dir_path.exists():
        if dry_run:
            print(f"  {YELLOW}[DRY RUN] Would delete {label}: {dir_path}{RESET}")
        else:
            shutil.rmtree(dir_path)
            print(f"  {GREEN}Deleted{RESET} {label}: {dir_path}")
    else:
        print(f"  {YELLOW}{label} not found at {dir_path} — nothing to delete{RESET}")


def main():
    parser = argparse.ArgumentParser(description="Reset Codex tools state for testing")
    parser.add_argument("--app-name", default="Codex", help="VS Code app name (default: Codex)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without making changes")
    parser.add_argument("--delete-ffmpeg", action="store_true", help="Delete downloaded FFmpeg binary")
    parser.add_argument("--delete-ffprobe", action="store_true", help="Delete downloaded FFprobe binary")
    parser.add_argument("--delete-sqlite", action="store_true", help="Delete downloaded SQLite binary")
    parser.add_argument("--delete-git", action="store_true", help="Delete downloaded Git binary")
    parser.add_argument("--delete-all", action="store_true", help="Delete all downloaded binaries")
    args = parser.parse_args()

    if args.delete_all:
        args.delete_ffmpeg = True
        args.delete_ffprobe = True
        args.delete_sqlite = True
        args.delete_git = True

    storage_root = get_global_storage_root(args.app_name)
    codex_storage = storage_root / CODEX_EXT_ID
    frontier_storage = storage_root / FRONTIER_EXT_ID

    if args.dry_run:
        print(f"\n{BOLD}{YELLOW}=== DRY RUN — no changes will be made ==={RESET}\n")
    else:
        print(f"\n{BOLD}=== Resetting Codex Tools State ({args.app_name}) ==={RESET}\n")

    print(f"  Global storage: {storage_root}\n")

    # Clear globalState flags
    print(f"{BOLD}Clearing globalState flags:{RESET}")
    clear_global_state_keys(storage_root, args.dry_run)

    # Delete binaries if requested
    if args.delete_ffmpeg or args.delete_ffprobe or args.delete_sqlite or args.delete_git:
        print(f"\n{BOLD}Deleting downloaded binaries:{RESET}")

        if args.delete_ffmpeg:
            delete_directory(codex_storage / "ffmpeg", "FFmpeg", args.dry_run)

        if args.delete_ffprobe:
            delete_directory(codex_storage / "ffprobe", "FFprobe", args.dry_run)

        if args.delete_sqlite:
            delete_directory(codex_storage / "sqlite3-native", "SQLite", args.dry_run)

        if args.delete_git:
            delete_directory(frontier_storage / "git", "Git (dugite)", args.dry_run)

    print(f"\n{GREEN}Done.{RESET} Run check_tools_status.py to verify.\n")


if __name__ == "__main__":
    main()
