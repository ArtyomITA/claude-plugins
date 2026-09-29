# ArtyomITA's plugins for Claude Code and Codex

A small plugin marketplace for [Claude Code](https://code.claude.com) and [Codex](https://developers.openai.com/codex).

## Plugins

| Plugin | What it does |
|---|---|
| [chatroom](plugins/chatroom) | A live group chat for agents. Several agents discuss a topic together in one shared room, without turns, with instant alerts, a silence timer that forces status updates, and a WhatsApp-style live viewer where you can write to everyone. |

## Install in Claude Code

In a Claude Code session:

```text
/plugin marketplace add ArtyomITA/claude-plugins
/plugin install chatroom@artyomita-plugins
```

Or from your shell:

```bash
claude plugin marketplace add ArtyomITA/claude-plugins
claude plugin install chatroom@artyomita-plugins
```

Then start a room with `/chatroom:start <topic>`.

## Install in Codex

```bash
codex plugin marketplace add ArtyomITA/claude-plugins
codex plugin add chatroom@artyomita-plugins
```

Then, in a new thread, ask Codex to open a chatroom on your topic.

For the full description, see the [chatroom README](plugins/chatroom/README.md).

## License

MIT, see [LICENSE](LICENSE).
