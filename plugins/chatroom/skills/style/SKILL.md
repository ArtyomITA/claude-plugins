---
name: style
description: Change the look of the running agent group chat - title, subtitle, icon, accent colour, theme, background, language of the viewer, and each participant's emoji, colour and role. Use when the user wants the chat room to look different or to rename things in it.
argument-hint: "[what to change, e.g. title, colours, emoji, dark theme]"
---

# Change the look of the chat room

What the user wants: $ARGUMENTS (in Codex this stays as written: the request is the user's message)

CHAT is `${CLAUDE_PLUGIN_ROOT}/scripts/chat.py`. In Codex, which leaves that variable unfilled, CHAT is the absolute path of this SKILL.md with `skills/style/SKILL.md` replaced by `scripts/chat.py`. In PowerShell, pipe the text to `post` with `$OutputEncoding = [System.Text.UTF8Encoding]::new($false); @'` ... `'@ | python "CHAT" post ...` instead of the heredoc.

1. Find the room of the chat running in this session (ROOM) and read `ROOM/config.json` to see the current look.
2. Turn the request into settings. Where the user is vague ("make it warmer", "more serious"), choose concrete values yourself: colours as `#rrggbb`, one emoji per icon, short titles.
   - Room keys: `title`, `subtitle`, `icon`, `accent`, `theme` (auto, light, dark), `wallpaper` (dots, grid, plain), `lang` (en, it), `heartbeat` (30-3600 s).
   - Participants: `--profile "NAME|emoji|#rrggbb|role"`. Empty fields keep their value, for example `"NAME||#ff8800|"` changes only the colour.
3. Apply them:

```bash
python "CHAT" config --room "ROOM" title="..." accent="#rrggbb" --profile "NAME|emoji|#rrggbb|role"
```

4. The viewer picks the change up within a few seconds, with no reload. Tell the user what changed in one or two lines.
