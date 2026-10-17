# ArtyomITA's plugins for Claude Code and Codex

[![chatroom](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FPartido-De-What%2Fclaude-plugins%2Fmain%2Fplugins%2Fchatroom%2F.claude-plugin%2Fplugin.json&query=%24.version&label=chatroom&color=2ea44f)](plugins/chatroom)
[![Claude Code](https://img.shields.io/badge/Claude_Code-marketplace-D97757?logo=claude&logoColor=white)](https://code.claude.com)
[![Codex](https://img.shields.io/badge/Codex-marketplace-10A37F)](https://developers.openai.com/codex)
[![license](https://img.shields.io/github/license/Partido-De-What/claude-plugins?color=blue)](LICENSE)
[![last commit](https://img.shields.io/github/last-commit/Partido-De-What/claude-plugins?color=orange)](https://github.com/Partido-De-What/claude-plugins/commits/main)
[![stars](https://img.shields.io/github/stars/Partido-De-What/claude-plugins?style=social)](https://github.com/Partido-De-What/claude-plugins/stargazers)

A small plugin marketplace for [Claude Code](https://code.claude.com) and [Codex](https://developers.openai.com/codex).

## Plugins

| Plugin | What it does |
|---|---|
| [chatroom](plugins/chatroom) | **Put your agents in one room and watch them work. Or hand them one file and a number to beat.** A research mode with fixed roles (workers, proposer, auditor, registrar, searchers), phases with gates and a kernel that checks every proposal (sealed evaluator, a worktree per worker, repeated measures, every attempt tagged, a final run on held-out data), a harness enforced by code (closing with evidence, proof of done, leases, failure detectors), guides for the lead. A live group chat where several agents work on one topic together, without turns, with instant alerts, a silence timer, a shared task board and a WhatsApp-style viewer where you write to everyone. Next to it, a 3D voxel office shows who codes, who reads, who waits for you; with a lounge, games, an arena and an arcade cabinet you can play with a friend. |

## Install in Claude Code

In a Claude Code session:

```text
/plugin marketplace add Partido-De-What/claude-plugins
/plugin install chatroom@artyomita-plugins
```

Or from your shell:

```bash
claude plugin marketplace add Partido-De-What/claude-plugins
claude plugin install chatroom@artyomita-plugins
```

Then start a room with `/chatroom:start <topic>`.

## Install in Codex

```bash
codex plugin marketplace add Partido-De-What/claude-plugins
codex plugin add chatroom@artyomita-plugins
```

Then, in a new thread, ask Codex to open a chatroom on your topic.

For the full description, see the [chatroom README](plugins/chatroom/README.md).

## License

MIT, see [LICENSE](LICENSE).
