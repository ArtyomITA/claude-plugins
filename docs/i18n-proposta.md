# i18n del plugin chatroom: inventario e proposta

Stato: inventario e proposta, niente codice. 17/10/2026, sorgente a 0.10.1 (0a13b19).

## 1. Inventario

Conteggio euristico (script in sola lettura): stringhe con almeno due parole, esclusi docstring, regex e argomenti di git
e subprocess.

### Python (testi per gli agenti e per il lead)

| File | Errori (`raise`, `sys.exit`) | Righe e risposte | CHECK | Help CLI | Tabelle già bilingui | Lingua oggi |
|---|---|---|---|---|---|---|
| chat.py | 107 (1.236 parole) | 178 (1.860) | 18 (292) | 69 (774) | 78 (2.431: comandi rapidi, card della modalità, brief di default, timer) | inglese; le tabelle sono en/it |
| research.py | 154 (1.874) | 135 (1.052) | (rilevatori dentro le righe) | (help in chat.py) | 0 | solo inglese |
| share.py | 56 (361) | 7 (39) | – | – | 11 (41) | inglese, una tabella en/it |
| activity.py | – | 21 (124) | – | – | 22 (126) | nessun testo visibile: nomi di strumenti e stati, tradotti dal JS |
| github_data.py | – | 12 (44) | – | – | – | solo inglese |

Totale da portare in un catalogo: circa 1.000 stringhe, circa 11.000 parole. Le tabelle bilingui sono scritte dentro
il codice, ognuna con la sua forma (`{'en': ..., 'it': ...}`, tuple per i comandi, `TIMER_NOTE`, `BRIEF_DEFAULT`).

### JS e HTML (interfaccia per l'utente)

| File | Stringhe | Parole | Meccanismo oggi |
|---|---|---|---|
| viewer.html | 65 | 434 | tabella `T = {en, it}` nel file, `t()`; alcuni `config.lang === 'it' ? ... : ...` sparsi |
| office-ui.js | 298 | 1.727 | tabella `L = {en, it}` nel file, `setLang()`; 75 stringhe solo italiane |
| office.js | 36 | 128 | 20 punti con `lang` |
| office-edit.js, -arcade.js, -github.js, -paintball.js, -rack.js | 70, 40, 38, 28, 14 | 199, 270, 129, 164, 88 | piccole tabelle locali o ternari sulla lingua |
| office-layout.js, -signs.js, -games.js, -tv.js, -arena.js, -voxel.js, -guns.js | 22, 10, 11, 9, 7, 3, 1 | 49, 46, 40, 21, 27, 26, 2 | per lo più fissi in una lingua |
| hooks/register.ts | 10 | 56 | fisso |

Totale circa 650 stringhe, circa 3.400 parole. Ogni file ha la sua tabella o i suoi ternari: niente di condiviso.

### Documenti letti dagli agenti (solo inglese)

| Gruppo | File | Parole |
|---|---|---|
| Template dei prompt | agent_prompt, helper_prompt, helper_rules_full, helper_rules_safe, research_worker, _auditor, _proposer, _registrar, _searcher | 5.920 |
| Guide del lead | lead-normal, lead-research | 4.217 |
| Skill | start, init, close, say, style | 5.470 |

Totale circa 15.700 parole. Oggi l'agente riceve il prompt in inglese, con "scrivi in {{LANGUAGE}}".

### Parole di protocollo (mai tradotte)

Il codice e gli agenti le riconoscono per forma, quindi restano fisse in tutte le lingue: `PLAN vN:` / `PIANO vN:`,
`VOTE` / `VOTO`, `CLOSED` / `CHIUSO` (già doppie), `ALERT`, `WATCH`, `CHECK`, `LEND`, `RELAY`, `error:`, `KEEP`,
`DISCARD`, `CRASH`, `SMOKE`, `att-N`, `E-n`, `I-n`, `protocol:`, `NAME: value`, `DEGRADED`, i nomi delle azioni
(`research evaluate`...) e delle chiavi JSON di stato.

## 2. Proposta

### Cataloghi

- Una cartella `plugins/chatroom/locales/` con un file per lingua: `en.json` (riferimento, completo) e `it.json`.
- Chiavi piatte con spazio dei nomi per destinatario: `kernel.seal_changed`, `chat.check.unanswered`,
  `chat.cmd.accelerate.title`, `viewer.empty`, `office.pool.setup`, `cli.help.min_gain`.
- Valori con segnaposto con nome: `"{file} è cambiato: ripristinalo (git checkout {head} -- {file}). Non è partito nulla."`.
  Plurali solo dove servono: `{"one": "...", "other": "..."}`.
- Lingua di riserva: `en`. Una chiave che manca (o è vuota) in `it` esce in inglese, mai vuota. Una chiave che manca
  anche in `en` è un errore di `i18n_check`; a run time mostra la chiave e avvisa una volta, senza fermare il comando.
  Un campo non passato resta scritto com'è (`{file}`), uguale in Python e JS.
- Eccezione: i nomi delle stanze e le insegne dell'ufficio (`office-layout.js`, `rooms` e `signs`) restano dati con
  `it`/`en` dentro il record, perché il layout si salva in `~/.claude/chatroom/office.json` e l'utente può cambiarli; la
  guida all'ingresso, i nomi dei mobili dell'editor e delle armi invece sono nel catalogo.
- Passo 2 (fatto): viewer (`viewer.*`) e ufficio (`office.*`, `arena.*`, `arcade.*`, `edit.*`, `github.*`,
  `paintball.*`, `rack.*`, `signs.*`, `guns.*`) leggono il catalogo con `I18N.table()` / `I18N.tables()`, che danno
  la stessa forma delle tabelle di prima (`L.chiave`, `L.funzione(a, b)`), così i punti di chiamata non cambiano.
- JS: `I18N.t()` fa l'escape HTML dei campi (risultato sicuro per `innerHTML`), `I18N.text()` no (per `textContent`).

### Codice

- Python: un modulo `i18n.py` (solo libreria standard), `tr(lang, key, **campi)`, con cache dei file. La lingua viene
  dal `lang` della stanza, già nel config. Le funzioni del kernel che oggi restituiscono testo ricevono la lingua dalla
  stanza.
- JS: `chat.py serve` pubblica `/locales/<lang>.json`; viewer e ufficio caricano un solo catalogo, e le tabelle `T`, `L`
  e i ternari sparsi diventano `t('viewer.empty')`. Il cambio di lingua dal pannello resta come oggi.
- Le parole di protocollo stanno in un elenco a parte nel codice, non nei cataloghi.

### Documenti per gli agenti

- Template e guide come file per lingua: `templates/it/research_worker.md`, `guides/it/lead-research.md`. Se una lingua
  non ha il file, si usa quello inglese. `chat.py prompt` e `chat.py guide` scelgono in base alla lingua della stanza.
- Un controllo meccanico confronta le due versioni: stessi campi `{{...}}`, stessi comandi, stessi passi numerati,
  stesse parole di protocollo. Così una traduzione non può perdere una regola.
- Skill: consiglio di lasciarle in inglese. Le legge il lead (Claude o Codex) e non l'utente; tradurle raddoppia la
  manutenzione delle istruzioni più delicate e non cambia nulla di quello che vede l'utente. Va deciso.

### Strumento di controllo

`tools/i18n_check.py`, in ogni giro di test, segnala:
- chiavi usate nel codice e assenti in `en.json`;
- chiavi di `it.json` che non esistono in `en.json`;
- segnaposto diversi tra le lingue;
- stringhe in linguaggio naturale rimaste nel codice fuori dal catalogo;
- documenti `it` con campi, comandi o passi diversi dalla versione `en`.

## 3. Ordine di lavoro (un passo per volta, ognuno con test e commit suoi)

1. Infrastruttura: `locales/`, `i18n.py`, il caricatore JS, `i18n_check.py`; nessun testo spostato.
2. Viewer e ufficio: le tabelle esistenti (già en/it) passano al catalogo; poi i testi fissi rimasti.
3. chat.py: tabelle (comandi, card, brief), poi CHECK, errori, righe del relay, help.
4. research.py: errori e righe del kernel.
5. share.py, activity.py, github_data.py, hooks/register.ts.
6. Template e guide in italiano, con il controllo di struttura.
7. (Se deciso) skill.

Volume da tradurre in italiano: circa 11.000 parole di stringhe Python, la parte non ancora bilingue di JS (stimo un
terzo delle 3.400 parole) e 10.100 parole di template e guide (15.700 con le skill).

## 4. Deciso (17/10/2026)

1. Lingue: `it` ed `en`.
2. Skill: restano in inglese (il passo 7 cade).
3. Lingua degli agenti: quella della stanza, per tutti.
4. Traduzione: Claude, con una revisione Haiku per ogni blocco.
   Poi (17/10 sera, su richiesta): i testi dei passi 4-6 li scrivono più agenti Haiku in parallelo, ognuno su un blocco
   con un validatore meccanico (campi, protocollo, flag, inizio e fine dei frammenti); alla fine test completi e una
   revisione completa Sonnet.

## 5. Stato (17/10/2026 sera)

- Passi 1-3 fatti (commit locali 1b7b088, a26a889, 1141583). Passi 4-6: research.py, share.py (testi e risposte
  HTTP), template e guide in `templates/it/` e `guides/it/`, `AGENTS.md` delle stanze (`templates/room_agents.md`).
- `chat.py prompt` e `chat.py guide` scelgono la traduzione per la lingua della stanza (`guide --lang it` o `--room`).
- Restano in inglese, per scelta:
  - lo scheletro del report research (`CHECKLIST` in research.py): il cancello della fase 5 confronta i suoi
    segnaposto `<...>` e la riga DEGRADED; tradurlo vuol dire uno scheletro e un controllo per lingua;
  - l'help della CLI (argparse) e le descrizioni degli strumenti MCP: sono il contratto con il client e la
    documentazione da terminale, uguali per tutte le stanze;
  - le `instructions` del server MCP: un solo server per tutte le stanze, prima di sapere la stanza;
  - i marcatori del relay e dello stato letti come forma: `VOTE-NO (LEAD REVIEW)`, `(vN > M: LEAD DECIDES)`, `[STATUS]`,
    `PAUSED`, oltre alle parole di protocollo;
  - il contenuto dei file di dati della ricerca (`results.tsv`, `findings-*.md`, `log.jsonl`): dati, non messaggi;
  - `activity.py` e `github_data.py`: nessun testo visibile (solo nomi di strumenti e stati che il JS traduce);
  - `hooks/register.ts`: è la mod di Claude Code, fuori dal processo della stanza;
  - le skill (decisione 2) e i nomi delle stanze e delle insegne dell'ufficio (dati salvati dall'utente).
- `i18n_check` controlla anche: variabili che nascondono `say`/`tr`, punti elenco e paragrafi dei documenti tradotti,
  paragrafi tradotti molto più corti dell'originale (una regola persa).
