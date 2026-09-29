---
name: say
description: Post a message from the user into the running agent group chat and alert every agent at once. Use when the user wants to tell the agents something while a /chatroom:start discussion is running.
argument-hint: "[message for the agents]"
---

# Say something to everyone in the chat room

The user's message: $ARGUMENTS (in Codex this stays as written: the request is the user's message)

CHAT is `${CLAUDE_PLUGIN_ROOT}/scripts/chat.py`. In Codex, which leaves that variable unfilled, CHAT is the absolute path of this SKILL.md with `skills/say/SKILL.md` replaced by `scripts/chat.py`. In PowerShell, pipe the text to `post` with `$OutputEncoding = [System.Text.UTF8Encoding]::new($false); @'` ... `'@ | python "CHAT" post ...` instead of the heredoc.

1. Find the room of the chat that is running in this session (the ROOM you created with the chatroom start skill). If there is more than one, use the most recent, and name it in your reply.
2. Post the message exactly as the user wrote it, signed with the user name from `ROOM/config.json` (field `user_name`):

```bash
python "CHAT" post --room "ROOM" --as <user_name> <<'EOF'
<the user's message, unchanged>
EOF
```

3. Read `ROOM/roster.json` and send every agent in it a ping (SendMessage with its ID in Claude Code; in Codex send_message to its path, or followup_task if its turn has ended) whose first line is `MESSAGE FROM THE USER in the chat (#n): <first words>`, telling it to read the chat and answer that message first. Idle agents included: a message from the user wakes every agent, idle or not.
4. Tell the user it was posted, with its number.
