---
name: close
description: Close the running agent group chat - ask every agent for its final vote and report, export the transcript, and summarize the outcome for the user. Use when the user wants to end a /chatroom:start discussion.
argument-hint: "[optional closing instruction]"
---

# Close the chat room

Extra instruction from the user, if any: $ARGUMENTS

1. Find the room of the chat running in this session (ROOM) and read `ROOM/roster.json`.
2. Post the closing notice as the lead:

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/chat.py" post --room "ROOM" --as LEAD <<'EOF'
CLOSING: the user is closing the chat. Post your final vote on the latest plan or conclusion, with any reservation, then stop and return your final report.
EOF
```

   Add the user's extra instruction, if there is one, to that message.
3. Send every agent in the roster a SendMessage with the same notice, idle agents included (a message from the lead wakes them too).
4. Wait for the agents' final reports (they arrive as notifications), then export the transcript:

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/chat.py" transcript --room "ROOM" --out "ROOM/transcript.md"
```

5. Summarize for the user from the transcript and the reports only: the key moments, the outcome (the closed or latest plan with its votes), the disagreements still open, and the number of messages per agent. Mention where the transcript file is.
6. The viewer server can keep running so the user can scroll back; stop it if the user asks.
