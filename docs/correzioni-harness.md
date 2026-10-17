# Correzioni all'harness dai 5 report dello sciame (17/10/2026)

Fonti: report INFRA, TASK, TOKEN, VERIF e COORD. Valgono per la stanza normale e per la modalità research (colonna R: come entrano nel kernel di research). Stato: ✅ fatto e provato (smoke test 47/47: scratchpad smoke.py) · 🔜 rimandato con motivo.

## Consegna e infrastruttura (INFRA)

| # | Correzione | R | Stato |
|---|---|---|---|
| C1 | MCP: `notifications/cancelled` gestita; un `chat_wait` annullato esce senza consumare i messaggi | stesso server per i ruoli research | ✅ |
| C2 | Client Codex (da `clientInfo` di initialize): `chat_wait` limitato a 50 s, sotto il `tool_timeout_sec` di 60 s; README con `tool_timeout_sec` | idem | ✅ |
| C3 | Lock con proprietario (pid + ora): si rompe dopo 20 s solo se il proprietario è morto, altrimenti dopo 60 s | il kernel scrive `state.json` sotto lo stesso lock | ✅ |
| C4 | `server/discover` della revisione MCP 2026-07-28 | | 🔜 la spec prevede il ritorno a initialize su errore: va provato in un client reale |
| C5 | Hook `SubagentStop` / `asyncRewake` per svegliare senza attese | | 🔜 campi non verificati, il report stesso dice di non farlo senza test |
| C6 | Span OpenTelemetry in activity.py | | 🔜 convenzioni ancora in bozza |

## Board, assegnazione, conflitti (TASK)

| # | Correzione | R | Stato |
|---|---|---|---|
| C7 | Lease: un task preso torna prendibile senza `--force` quando il proprietario tace da 5 heartbeat e non è in idle; la riga [BOARD] lo dice | i cicli della coda research | ✅ |
| C8 | `task next --as NOME`: prende il primo task aperto con dipendenze chiuse e file liberi | il WORKER prende il ciclo | ✅ |
| C9 | `task add --verify "CMD" [--cwd DIR]` solo dal lead o dall'utente; `done` esegue CMD (timeout), rifiuta se esce diverso da 0, la prova registra exit code, ultime righe e hash dell'output | è `research evaluate` in piccolo | ✅ |
| C10 | `done --touched "firme cambiate"`: una riga FINDING che tutti leggono | interfacce del programma candidato | ✅ |
| C11 | `task add --merge-into RAMO`: `done` prova `git merge-tree --write-tree` e rifiuta se ci sono conflitti | ramo per idea (A4) | ✅ |
| C12 | Skill: un agente solo di default, team solo con 3 o più pezzi indipendenti | 2 worker fissi | ✅ |
| C13 | Gruppi di file dal grafo degli import | | 🔜 costo alto, uno per linguaggio |

## Token e contesto (TOKEN)

| # | Correzione | R | Stato |
|---|---|---|---|
| C14 | `wait --focus` (non in idle) si sveglia solo per ciò che ti riguarda o per il timer; il resto aspetta come riassunto | viste limitate per ruolo | ✅ |
| C15 | ALERT solo ai taggati, a tutti per utente/lead/@tutti/PLAN/VOTE/CLOSED; un messaggio senza tag non manda ping | | ✅ |
| C16 | Riassunto per autore costruito dallo status JSON (pct, next, needs) con `#n`, non dalla prima riga troncata | | ✅ |
| C17 | `read --range A-B` (anche MCP `chat_read` con `range`) | `research expand ID` | ✅ |
| C18 | Prompt: fermati e dillo al lead se ti manca una capacità; notebook con `#n` e `file:riga` | | ✅ |
| C19 | Stallo deterministico: 2 status JSON di fila con stessa percentuale e stesso `next` | circuit breaker | ✅ |
| C20 | Contatore di chiamate per agente (post, read, wait) in `status`; avviso BUDGET nel relay oltre la soglia `budget_calls` | budget dei ruoli | ✅ |

## Prove, voti, chiusura (VERIF, con revisione del lead)

| # | Correzione | R | Stato |
|---|---|---|---|
| C21 | `done` rifiuta una prova senza artefatto (exit code, test passati, `file:riga`, `#n`, hash, percorso, URL); `--gaps` "cosa non ho fatto"; prova fino a 2000 caratteri | rubric con evidenza | ✅ |
| C22 | `CLOSED vN` passa solo se ogni partecipante attivo ha votato `VOTE vN: yes` con una prova nella riga; il lead e l'utente possono chiudere sempre | cancelli dell'AUDITOR | ✅ |
| C23 | Voto diviso (un `no` su vN) = revisione del LEAD: il post lo dice e il relay lo segnala | il lead decide al cancello | ✅ |
| C24 | Tetto: dopo `PLAN v3` solo il lead può pubblicare una nuova versione | tetto ai cicli di revisione | ✅ |
| C25 | Regola 6 del prompt: cambi posizione solo con una prova nuova, mai per numero di voti; prima posizione scritta prima di leggere le altre; un `yes` cita cosa hai verificato | prompt dell'AUDITOR | ✅ |
| C26 | `check`: prova senza artefatto, task chiuso con gap, voto girato da no a yes senza prova | | ✅ |

## Coordinamento (COORD)

| # | Correzione | R | Stato |
|---|---|---|---|
| C27 | `check`: status al 100% senza evidenza né artefatto (il report finale che dice "fatto" senza prova) | rubric senza evidence | ✅ |
| C28 | `check` deriva: 25 messaggi veri di fila senza una riga [BOARD], un fatto o una decisione | | ✅ |
| C29 | `check` stallo di gruppo: tutti i partecipanti in idle, nessun task in corso, nessun PLAN aperto | circuit breaker | ✅ |
| C30 | Prima posizione scritta dopo aver letto gli altri: segnata sul messaggio (`after_read`) e in `check`, solo informativo | | ✅ |
| C31 | `--files` con cartelle (`src/net/`): un task su `src/net/a.py` e uno su `src/net/` si scontrano | | ✅ |
| C32 | `task amend ID --files c.py`: il proprietario allarga lo scope se nessuno tiene quei file; altrimenti lo chiede al LEAD | | ✅ |
| C33 | Con `--merge-into`, `done` confronta `git diff --name-only` con i file dichiarati; quelli in più finiscono in `check` | file toccati fuori dall'idea | ✅ |
| C34 | Prompt: ogni fatto e ogni percentuale con la fonte (`#n`, `file:riga`, comando); un'affermazione non controllata si scrive "non verificato"; notebook letto all'inizio, non solo dopo una compattazione | | ✅ |
| C35 | Skill: il lead dichiara il tipo di intervento (sfida, chiarimento, chiedere prova, smistare) | | ✅ |
| C36 | Monitor formale delle transizioni (TLA+) | | 🔜 costo alto; le transizioni della board sono già controllate in codice |
| C37 | Metriche di valutazione dell'harness a ogni modifica (2605.26112) | | 🔜 è un metodo di lavoro: da fare con il banco di prova (C2 alem in integrazioni-harness.md) |
| — | Reviewer di un'altra famiglia di modelli | | scartato dall'utente |

## Revisione 1 (Sonnet 5.5 xhigh, 17/10/2026): 25 bug, tutti corretti

| Bug | Correzione |
|---|---|
| B1 `--verify` impostabile da chi si firma LEAD, anche via MCP | `verify`, `merge_into`, `cwd` rifiutati via MCP: da shell l'agente non ha più poteri del suo Bash. Nota: sulla stessa macchina e con lo stesso utente un controllo per nome non può essere una capacità vera; il kernel research usa lo stesso confine (init solo da shell) |
| B2 PLAN/CLOSED non visti in risposta o in grassetto | lettura a inizio riga dopo `↪ #n`, tag e markdown (`heads()`), uguale in chat.py, share.py, office.js, viewer |
| B3 "Closed the first point" rifiutato | `CLOSED`/`CHIUSO` solo in maiuscolo; `config closing_gate=0` per altre regole di chiusura |
| B4 `--merge-into` chiudeva senza lavoro | rifiuta lavoro non committato e ramo senza commit propri |
| B5 timeout del verify inefficace su Windows | albero di processi ucciso (`taskkill /T`, `killpg`); limite 110 s di default, `--verify-timeout` |
| B6 tetto Codex fisso a 50 s | segue `CHATROOM_TOOL_TIMEOUT` (meno 10 s); niente riga di avviso |
| B7 regola 7 contro "prima posizione" | eccezione esplicita nella regola 7 |
| B8 amend e confronto file | amend del LEAD su ogni task (`--force` sopra altri task); controlla anche i task aperti; `.`/`./` = tutto l'albero; maiuscole indifferenti su Windows |
| B9 nomi come sottostringa | nome come parola intera |
| B10 topic "Chat room" | skill init passa `--topic` e lo aggiorna con `config` |
| B11 regex lenta | quantificatori limitati, testo letto fino a 4000 caratteri (100k caratteri: 3 ms) |
| B12 `check` lento | config e board letti una volta |
| B13 counters.json punto di rottura | un file per agente, senza lock, un file rotto vale zero |
| B14 CHECK ripetuti e rumorosi | elenco dei CHECK già detti salvato; deriva solo se la board è usata; "tutti idle" no se aspettano l'utente; 100% non controllato sugli idle |
| B15 artefatti troppo larghi | niente "e.g.", "5 s", parole esadecimali senza cifre; file solo con percorso, `:riga` o estensione di codice |
| B16 testo "un no senza prova non conta" | testo corretto: il no blocca comunque e il LEAD chiede la prova |
| B17 voto citato contato | voti solo a inizio riga |
| B18 due titolari del lock | token nel lock, rottura per rinomina atomica, rilascio solo del proprio token |
| B19 documentazione vecchia | skill start, README aggiornati |
| B20 flusso init su stanza viva, TIMER al lead, propri messaggi | stanza viva riprende da 4a/4b; il lead e l'utente fuori dal timer; nessuno rilegge i propri messaggi |
| B21 un agente sceglieva la modalità | solo utente o lead; messaggio chiaro senza `--ask-mode` |
| B22 `task next` rubava pezzi prestati | un pezzo prestato scade solo verso chi l'ha prestato |
| B23 `update_config` senza lock | sotto lock |
| B24 vecchi task segnalati | il controllo artefatto vale solo per task chiusi con la regola nuova (`rule: 2`) |
| B25 riassunto mai consegnato | `wait --focus` ritorna anche con 20 messaggi in attesa o dopo 3 heartbeat |

## Punti dei report fatti a metà (revisione 1)

| Punto | Stato |
|---|---|
| TASK: token di versione | tolto (revisione 2: veniva scritto e mai letto); il controllo del proprietario a ogni `done` fa da recinto |
| TASK: `task accept` entro N min | ✅ 10 min, poi il pezzo torna a chi l'ha prestato; CHECK `unaccepted` |
| TASK: verify nel worktree dell'agente | ✅ senza `--cwd` gira dove l'agente esegue `done`; via MCP rifiutato se manca `--cwd`; prova con le ultime 3 righe |
| VERIF: elenco file richiesti/letti | ✅ CHECK `coverage`: la prova non nomina un file dichiarato |
| VERIF: no che deve portare la prova | ✅ il no blocca e va al LEAD, che chiede la prova (EVIDENCE) |
| COORD: consenso prematuro | ✅ CHECK su CLOSED senza un solo no in tutte le versioni |
| TOKEN: riassunto con verdetto e verifica | ✅ `done`, `risks`, `evidence` nel riassunto |
| Research: lease durante un evaluate lungo | ✅ `research evaluate` scrive una riga "running" prima di partire |
| INFRA: conferma di consegna (ack) | 🔜 MCP non ha conferme di consegna: mitigato con tetto sotto il timeout del client, cancellazione, `read --range` per recuperare |
| INFRA: inbox per agente | 🔜 non serve finché la contesa resta bassa (5 processi × 12 post: 60 messaggi ordinati) |
| TOKEN: default CLI/MCP di `read` | deciso: la CLI resta completa (la usano utente e lead), MCP e prompt degli agenti usano `--focus` |
| TOKEN: prova su stanza vera prima di adottare `--focus` | ⏳ da fare con l'utente su una stanza reale |
| COORD: "fatto senza exit 0 nel transcript" | 🔜 i transcript di Claude Code e Codex hanno formati diversi; coperto in parte da `--verify` e `coverage` |

## Revisione 2 (Sonnet 5.5 xhigh): correzioni

| Punto | Correzione |
|---|---|
| N1 MCP bloccato su Windows (figli che ereditano lo stdin) | `stdin=DEVNULL` su ogni comando figlio (chat.py, research.py, share.py); test MCP con git e verify veri |
| B20 il lead nel timer di `wait` | lead e utente fuori dal timer anche in `wait` |
| B9 nome corto come parola comune | nomi cercati come la stanza li scrive (maiuscoli); i tag `@` in ogni caso |
| B16 testo di chiusura | brief di default allineato: un no blocca sempre, senza prova il LEAD la chiede |
| B17 voto citato | voto solo sulla prima riga del messaggio; righe che iniziano con `>` ignorate |
| N3 commenti presi per piani o chiusure | PLAN/CLOSED sono intestazioni: dopo la versione serve `:`, `-`, `.`, `)` o fine riga |
| N5 emoji, numeri, grassetto | tolti davanti alla parola (Python e JS) |
| N4 "sì" in JS | confine Unicode (`/u`) in office.js e viewer |
| B19, N9 documentazione | percorso del lock, cinque skill, strumento MCP `research` |
| B23 config senza lock | `edit_config` sotto lock per add, remove, helper prestati, amici |
| N2 tag al lead | "il lead legge tutto dal relay" al posto di "nessun tag" |
| N6 copertura su `--merge-into` | esclusa (i file cambiati sono già controllati) |
| N7 `--force` saltava la prova | solo il lead può chiudere senza artefatto |
| N8 setup letto dagli agenti | messaggi di setup (carta e scelta) solo per il lead, senza banner |
| B14 attesa dell'utente in italiano | parole utente/user/committente/lead nel testo idle |
| R1 file non tracciati o ignorati | rifiutati i nuovi file; `git clean -ffdx` prima di ogni run |
| R2 metrica falsificabile dall'output | `--result-file` ($CHATROOM_RESULT fuori dal worktree); senza, la riga della metrica deve essere una sola |
| R3 run interrotta = ricerca bloccata | stato `pending` scritto prima del commit; alla chiamata dopo diventa crash e il programma torna al migliore |
| R4 baseline in crash | `research amend` (lead) per evaluator e budget prima della baseline; budget e numero di run sempre |
| R5 timeout dei client | il prompt dà il timeout di shell; via MCP Codex rifiutato se la run può superarlo |
| R6 nomi non ASCII | `core.quotepath=false` |
| R7 sigillo su file non tracciato | rifiutato all'init |
| R8 stanza relativa | percorsi assoluti |
| R9 righe tolte | conteggio inserzioni e cancellazioni separati |
| R10 budget negativi | rifiutati |
| R11 worktree non suo | controllo di cartella e ramo prima di ogni comando git |
| R12 hook e firma del repo | commit del kernel con identità propria, `--no-verify`, senza firma |
| R13 eval.lock bloccato | scade se il proprietario è morto o dopo 2×budget+300 s; il messaggio nomina il file |
| R14 worktree sparito | messaggio chiaro |
| R15 brief del worker | niente limite di messaggi, `task.md` come materiale di default |
| R16 file di stato scrivibili | limite dichiarato nel codice: con lo stesso utente il sigillo è un controllo, non un muro |
| C3 colonna R "stato sotto lo stesso lock" | ora vero: lo stato research si scrive sotto il lock della stanza |

Test: smoke.py 47/47, smoke2.py 46/46, smoke3.py 46/46 (MCP con git e verify su Windows, kernel research), smoke_research.py 21/21.

## Revisione 3 (Sonnet 5.5 xhigh): correzioni

| Punto | Correzione |
|---|---|
| B-1 intestazioni troppo strette | dopo `PLAN vN`/`CLOSED vN` basta che non segua un'altra parola: "PLAN v1 (draft)", "PLAN v1, rivisto", "CLOSED v1 (all agreed)", "CLOSED ✅", "CLOSED!" contano; `V` maiuscola accettata; "PLAN v1 also needs a test" resta una frase. Uguale in Python e JS |
| B-2 run "interrotta" prima del commit | se `add`/`commit` falliscono, lo stato "in corso" si toglie subito e la modifica resta; un "in corso" senza commit si scarta senza contare; un tag mancante viene ricreato o il messaggio nomina il commit |
| B-3 voti tra virgolette, prima riga di soli tag, voto in seconda riga | righe che iniziano con `>`, virgolette, apici inversi o parentesi sono citazioni; le righe di soli tag o simboli si saltano; un voto non in prima riga riceve l'avviso "non conta, ripubblicalo" e la regola 6 del prompt lo dice |
| B-4 `__pycache__` come file nuovo | cache Python escluse dal controllo (le toglie comunque la pulizia) |
| B-5 dati ignorati cancellati, pulizia fallita = run persa | `--keep data/` per cartelle di dati mai pulite; pulizia senza errore fatale, con avviso |
| B-6 stallo nascosto da "you"/"lead" | solo il nome dell'utente o del lead, o "utente"/"the user"/"committente" |
| B-7 timeout oltre il massimo del Bash | oltre 600 s il prompt chiede di lanciare la valutazione in background |
| Nomi corti ("Plan B", "Option A") | nomi di una o due lettere contano solo come tag `@A` |
| eval.lock con due worker | presa per rinomina atomica, un solo vincitore |
| `common` letto fuori lock | `edit_config` |

Test: smoke4.py 33/33 (casi della revisione 3, anche JS con node).
