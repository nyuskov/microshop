"""Подбор имён Font Awesome для наших «логических» имён иконок.

Не является частью сборки: вспомогательный скрипт, который проверяет, что каждое
имя из MAP есть в Font Awesome Free, и предлагает замену, если имени нет.
"""

import difflib
import json
import pathlib
import re
import sys

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
FA_CSS = FRONTEND / "node_modules/@quasar/extras/fontawesome-v7/fontawesome-v7.css"

MAP = {
    "add": "plus",
    "add_reaction": "face-smile-wink",
    "arrow_back": "arrow-left",
    "arrow_downward": "arrow-down",
    "arrow_drop_down": "caret-down",
    "arrow_drop_up": "caret-up",
    "arrow_forward": "arrow-right",
    "attach_file": "paperclip",
    "auto_stories": "book-open",
    "block": "ban",
    "bookmark": "bookmark",
    "call": "phone",
    "call_end": "phone-flip",
    "call_missed": "phone-slash",
    "cancel": "circle-xmark",
    "chat_bubble": "comment",
    "check": "check",
    "check_circle": "circle-check",
    "chevron_left": "chevron-left",
    "chevron_right": "chevron-right",
    "clear": "xmark",
    "close": "xmark",
    "cloud": "cloud",
    "cloud_upload": "cloud-arrow-up",
    "computer": "desktop",
    "contacts": "address-book",
    "content_copy": "copy",
    "dark_mode": "moon",
    "date_range": "calendar-days",
    "delete": "trash",
    "delete_forever": "trash-can",
    "delete_outline": "trash-can",
    "description": "file-lines",
    "devices": "laptop",
    "done": "check",
    "done_all": "check-double",
    "download": "download",
    "edit": "pen",
    "error": "circle-exclamation",
    "expand_less": "chevron-up",
    "expand_more": "chevron-down",
    "fiber_manual_record": "circle",
    "first_page": "angles-left",
    "flag": "flag",
    "forum": "comments",
    "forward": "share",
    "forward_to_inbox": "share",
    "fullscreen": "expand",
    "gavel": "gavel",
    "group": "users",
    "group_add": "user-plus",
    "help_outline": "circle-question",
    "image": "image",
    "info": "circle-info",
    "insert_drive_file": "file",
    "keyboard_arrow_down": "chevron-down",
    "keyboard_arrow_left": "chevron-left",
    "keyboard_arrow_right": "chevron-right",
    "keyboard_arrow_up": "chevron-up",
    "last_page": "angles-right",
    "light_mode": "sun",
    "lock": "lock",
    "lock_reset": "key",
    "logout": "arrow-right-from-bracket",
    "mail": "envelope",
    "menu": "bars",
    "menu_open": "bars",
    "mic": "microphone",
    "mic_off": "microphone-slash",
    "more_horiz": "ellipsis",
    "more_vert": "ellipsis-vertical",
    "navigation": "location-arrow",
    "notifications": "bell",
    "notifications_off": "bell-slash",
    "palette": "palette",
    "pause": "pause",
    "person": "user",
    "person_add": "user-plus",
    "person_remove": "user-minus",
    "phone_android": "mobile",
    "phonelink_erase": "mobile-button",
    "phonelink_lock": "mobile-screen",
    "photo_camera": "camera",
    "picture_as_pdf": "file-pdf",
    "play_arrow": "play",
    "privacy_tip": "user-shield",
    "push_pin": "thumbtack",
    "radio_button_checked": "circle-dot",
    "radio_button_unchecked": "circle",
    "refresh": "rotate-right",
    "replay": "rotate-left",
    "reply": "reply",
    "schedule": "clock",
    "screen_share": "display",
    "search": "magnifying-glass",
    "send": "paper-plane",
    "sentiment_satisfied_alt": "face-smile",
    "shield": "shield",
    "skip_next": "forward-step",
    "skip_previous": "backward-step",
    "sms": "comment-sms",
    "star": "star",
    "stop": "stop",
    "stop_screen_share": "display",
    "tune": "sliders",
    "undo": "rotate-left",
    "unfold_more": "up-down",
    "verified": "certificate",
    "videocam": "video",
    "visibility": "eye",
    "visibility_off": "eye-slash",
    "volume_down": "volume-low",
    "volume_off": "volume-xmark",
    "volume_up": "volume-high",
    "warning": "triangle-exclamation",
    "wifi": "wifi",
    "wifi_off": "link-slash",
}


def main() -> int:
    css = FA_CSS.read_text(encoding="utf-8")
    existing = set(re.findall(r"^\.fa-([a-z0-9-]+) \{", css, re.MULTILINE))
    print(f"иконок в Font Awesome Free: {len(existing)}")

    missing = {k: v for k, v in MAP.items() if v not in existing}
    if not missing:
        print("все имена найдены")
        pathlib.Path("/tmp/fa-map.json").write_text(
            json.dumps(MAP, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return 0

    for key, value in missing.items():
        close = difflib.get_close_matches(value, existing, n=3, cutoff=0.55)
        print(f"нет: {key} → {value}   похожие: {close}")
    print(f"итого нет: {len(missing)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
