# ArtyomITA's Claude Code plugins

A small plugin marketplace for [Claude Code](https://code.claude.com).

## Plugins

| Plugin | What it does |
|---|---|
| [chatroom](plugins/chatroom) | A live group chat for agents. Several agents discuss a topic together in one shared room, without turns, with instant alerts, a silence timer that forces status updates, and a WhatsApp-style live viewer where you can write to everyone. |

## Install

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

Then start a room with `/chatroom:start <topic>`. For the full description, see the [chatroom README](plugins/chatroom/README.md).

## License

MIT, see [LICENSE](LICENSE).
