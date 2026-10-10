// The chatroom mod. Runs inside Claude Code, in the session that opened a room (the lead), where every subagent's
// tool call passes. It does three things:
// - tells the room's viewer what each room agent is doing (tool start and end, a permission it waits for), so the
//   3D office animates it at once; agents of other sessions or of no room are left alone;
// - writes the roster by itself: an agent spawned with a description that starts with a participant's name
//   ("FETTE: checks the parser") is that participant;
// - adds /stanza: a pane with the room (who works, who waits for you, the last messages, a box to write to all),
//   and toasts when someone tags you, a plan or a closing arrives, or an agent starts waiting for you.
// Rooms are found in ~/.claude/chatroom/rooms.json, which `chat.py serve` stamps every few seconds.
import type { Register } from 'claude-code'

type Room = { url: string; ts: number; ids: string[]; participants: string[]; user: string; title: string }
type Agent = { tool?: string | null; target?: string; since?: number | null; waiting?: number | null }
type Message = { n: number; from: string; text: string; kind?: string; ts?: number }
type Summary = {
  title: string; user: string; lang?: string; participants: string[]; heartbeat: number; n: number
  last: Message[]; idle: string[]; pct: Record<string, number>; state: { agents?: Record<string, Agent> }
}

const PANE = 'stanza'
const FIELDS = ['file_path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description', 'to']
let registry = ''
let rooms: Record<string, Room> = {}
let paneOpen = false
const summaries = new Map<string, Summary>()
const seen = new Map<string, number>()
const waitingSeen = new Map<string, Set<string>>()
const running = new Set<string>()

const roomOf = (id?: string) => (id ? Object.values(rooms).find(r => r.ids.includes(id)) : undefined)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const startsWithName = (d: string, name: string) => new RegExp('^\\s*' + escapeRe(name) + '(?![\\w-])', 'i').test(d)
const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
function pick(e: Record<string, unknown>) {
  const out: Record<string, string> = {}
  for (const k of FIELDS) if (typeof e[k] === 'string') out[k] = (e[k] as string).slice(0, 300)
  return out
}

function send($: any, room: Room, ev: object) {
  void $.http.fetch(room.url + '/hook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev),
  }).catch(() => undefined)
}

async function refresh($: any) {
  try {
    const now = Date.now() / 1000
    const all = JSON.parse(await $.fs.read(registry)) as Record<string, Room>
    rooms = Object.fromEntries(Object.entries(all).filter(([, r]) => now - r.ts < 60))
  } catch {
    rooms = {}
  }
  for (const [key, room] of Object.entries(rooms)) {
    try {
      const r = await $.http.fetch(room.url + '/summary.json')
      if (!r.ok) continue
      const s = JSON.parse(r.text) as Summary
      summaries.set(key, s)
      alerts($, key, s)
    } catch {
      // the room's server is gone: the registry drops it within a minute
    }
  }
  for (const key of [...summaries.keys()]) if (!rooms[key]) summaries.delete(key)
  if (paneOpen) $.ui.invalidate('ui.render')
}

function alerts($: any, key: string, s: Summary) {
  const it = s.lang !== 'en'
  const before = seen.get(key)
  seen.set(key, s.n)
  if (before !== undefined) {
    for (const m of s.last) {
      if (m.n <= before || m.kind || m.from === s.user) continue
      const tagged = new RegExp('@' + escapeRe(s.user) + '(?![\\w-])', 'i').test(m.text)
      if (tagged || /^\s*(PLAN|PIANO|CLOSED|CHIUSO)\b/i.test(m.text)) $.ui.toast(`💬 ${m.from}: ${oneLine(m.text, 90)}`)
    }
  }
  const agents = s.state.agents || {}
  const waiting = new Set(Object.keys(agents).filter(n => agents[n].waiting))
  const was = waitingSeen.get(key) || new Set<string>()
  waitingSeen.set(key, waiting)
  for (const n of waiting) {
    if (was.has(n)) continue
    const text = `🙋 ${n} ${it ? 'ti aspetta' : 'needs you'} (${s.title})`
    $.ui.toast(text)
    void $.ui.notify(text).catch(() => undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR'))
      || `${(await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''}/.claude`
    registry = `${dir}/chatroom/rooms.json`
    await $.command.register({
      name: 'stanza', immediate: true,
      description: 'Show the open chatroom: who works, who waits for you, the last messages, a box to write to all',
    })
    $.clock.every(3000, () => refresh($))
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'stanza' }, async $ => {
    paneOpen = true
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Stanza', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  }).catch(($, e, next) => next(e))          // fail open: a fault here never blocks the session

  // what each room agent does, at once: tool start and end
  on('tool.call', async ($, e, next) => {
    const room = roomOf(e.agentId)
    if (!room) return next(e)
    const id = e.tool_use_id || `${e.agentId}-${Date.now()}`
    running.add(id)
    send($, room, { kind: 'tool', agentId: e.agentId, id, tool: e.tool, input: pick(e as Record<string, unknown>) })
    let ok = false
    try {
      const ran = await next(e)
      ok = ran.deny === undefined && !ran.isError
      return ran
    } finally {
      running.delete(id)
      send($, room, { kind: 'done', agentId: e.agentId, id, ok })
    }
  }).catch(($, e, next) => next(e))          // fail open: a fault here never blocks the session

  // a permission prompt: flagged only if the call is still waiting after 2.5 s (auto mode often decides at once)
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const room = roomOf(e.agentId)
    const id = e.tool_use_id
    if (room && id && verdict.decision === 'ask') {
      $.clock.after(2500, () => { if (running.has(id)) send($, room, { kind: 'ask', agentId: e.agentId, id }) })
    }
    return verdict
  }).catch(($, e, next) => next(e))          // fail open: a fault here never blocks the session

  // the roster writes itself
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined && started.agentId) {
      for (const room of Object.values(rooms)) {
        if (!room.participants.some(n => startsWithName(e.description, n))) continue
        room.ids.push(started.agentId)
        send($, room, { kind: 'spawn', agentId: started.agentId, description: e.description })
      }
    }
    return started
  }).catch(($, e, next) => next(e))          // fail open: a fault here never blocks the session

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Input } = $.ui.resolve(e)
    const width = Math.max(40, (e.props.bodyColumns ?? 80) - 2)
    const list = [...summaries.entries()]
    if (!list.length) {
      return Text({ dimColor: true, children: ['No open chatroom: start one with /chatroom:start, or run chat.py serve.'] })
    }
    const children: unknown[] = []
    for (const [key, s] of list) {
      const it = s.lang !== 'en', agents = s.state.agents || {}, room = rooms[key]
      const waiting = s.participants.filter(n => agents[n]?.waiting)
      children.push(Box({
        flexDirection: 'row', columnGap: 2, children: [
          Text({ bold: true, children: [`🏢 ${s.title}`] }),
          Text({ dimColor: true, children: [room ? room.url : ''] }),
          waiting.length ? Text({ color: 'red', bold: true, children: [`🙋 ${waiting.length} ${it ? 'ti aspettano' : 'need you'}`] }) : Text({ children: [''] }),
        ],
      }))
      for (const n of s.participants) {
        const a = agents[n] || {}, idle = s.idle.includes(n), pct = s.pct[n]
        const icon = a.waiting ? '🙋' : idle ? '💤' : a.tool ? '⚙️' : '·'
        const doing = a.waiting ? (it ? 'TI ASPETTA: ' : 'NEEDS YOU: ') + `${a.tool || ''} ${a.target || ''}`
          : idle ? 'idle' : a.tool ? `${a.tool} ${a.target || ''}` : ''
        children.push(Text({
          color: a.waiting ? 'red' : undefined, dimColor: idle,
          children: [oneLine(`${icon} ${n.padEnd(10)} ${pct === undefined ? '  —' : String(pct).padStart(3) + '%'}  ${doing}`, width)],
        }))
      }
      children.push(Text({ dimColor: true, children: [it ? '— ultimi messaggi' : '— last messages'] }))
      for (const m of s.last.filter(x => !x.kind).slice(-6)) {
        children.push(Text({ color: m.from === s.user ? 'magenta' : undefined, children: [oneLine(`#${m.n} ${m.from}: ${m.text}`, width)] }))
      }
      if (room) {
        children.push(Input({
          key: 'say-' + key, label: it ? `Scrivi a tutti come ${s.user}` : `Write to all as ${s.user}`, value: '',
          placeholder: it ? '@NOME per taggare' : '@NAME to tag', submitLabel: it ? 'invia' : 'send',
          onSubmit: async (value: string) => {
            if (!value.trim()) return
            await $.http.fetch(room.url + '/post', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: value.trim() }),
            })
            await refresh($)
          },
        }))
      }
    }
    return Box({ flexDirection: 'column', children })
  })
}
