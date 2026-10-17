# Modalità `research` della chatroom: progetto (A1 + A2)

Stato: progetto, nulla implementato. Elenco completo delle integrazioni: [integrazioni-research.md](integrazioni-research.md).

Letti per intero (testo arXiv): Sakana, *The Agentic Scientist* ([2610.18933](https://arxiv.org/abs/2610.18933), 13/10/2026, sezioni 1-8, appendice F con i prompt reali degli agenti, task di esempio G.1.1 e G.5); *Harness-Search* ([2610.05382](https://arxiv.org/abs/2610.05382), 04/10/2026, metodo, algoritmo, ablation, budget, prompt dei tre ruoli); *PatchBoard* ([2605.29313](https://arxiv.org/abs/2605.29313), 28/05/2026, kernel, contratti, viste, circuit breaker, fault injection); *MemTX* ([2607.23929](https://arxiv.org/abs/2607.23929), 27/07/2026, ciclo di vita dei record, commit, cascata, invarianti).

---

## 0. Avvio: `/chatroom:init`

1. La skill `init` crea la stanza (cartella di default), avvia il viewer e lo apre in **vista chat** (l'ufficio resta a un clic, come oggi).
2. In chat compare una scheda con due scelte: **Normale** (default) e **Research**. È un messaggio speciale del server, non testo scritto dal lead.
3. Il lead (il modello della sessione) è già in ascolto (`wait --as LEAD` o il relay sotto Monitor) e legge la scelta:
   - **Normale**: la stanza resta com'è oggi; il lead aspetta che l'utente dica argomento, partecipanti e look, poi prepara tutto con la procedura attuale.
   - **Research**: il lead apre la fase **0. Contratto** (sezione 2) e la scrive insieme all'utente in chat.
4. **Prompt iniettati in modo deterministico**: ogni prompt di agente lo produce `chat.py prompt RUOLO --room R --as NOME` riempiendo un template del plugin con i dati della stanza; il lead lo passa **invariato** al tool Agent (o `spawn_agent` in Codex). Il lead non riscrive i prompt: cambia solo i dati (contratto, ruoli, budget) che i template leggono. Lo stesso vale per i messaggi di sistema della stanza (cambi di fase, rifiuti del kernel, verdetti dell'auditor): li scrive `chat.py`.
5. La guida d'uso si scrive alla fine.

---

## 1. Cosa prendiamo da ciascun paper, e perché

### 1.1 Sakana, *The Agentic Scientist* (A1)

| Loro | Cosa imparare | Da noi |
|---|---|---|
| Contratto del compito: programma iniziale, **search evaluator** (dice se un candidato è corretto e dà il punteggio), **final evaluator** facoltativo (gira una volta dopo la ricerca), contratto con interfaccia del candidato e procedure di valutazione. "L'evaluator possiede accesso ai dati, budget, controlli di integrità e punteggio; i componenti di ricerca restano del candidato" | separazione netta tra ciò che l'agente può cambiare e ciò che misura | `research/task/` sigillato; l'evaluator lo lancia il kernel, mai l'agente |
| `task.md` con sezioni fisse: Goal, Upstream and Data, Evaluation, Compute Budget, Task-Drafting Requirements, Rubrics (es. G.1.1: seed di ricerca 101 e 211, seed finali 1009, 2017, 3011, dati finali esclusi da ogni decisione, "le celle fallite valgono zero, mai scartarle o rinormalizzare") | il contratto è il punto dove nascono i guasti | stesse sezioni, scritte con l'utente nella fase 0 |
| Drafting: agente di design → **agente di revisione** che ripara il design → agente che scrive il codice → controlli del contratto e **smoke test** → **alignment judge** (fedeltà scientifica, evaluator di ricerca e finale indipendenti su dati disgiunti) → prova di produzione con il carico intero; solo chi passa tutto va avanti | | fase 1 con gli stessi controlli, l'auditor fa da alignment judge |
| Ideazione **in sola lettura**: legge compito, idee e tentativi recenti, manifest del best, conclusioni distillate; scrive solo `idea_bundle.json` (`idea_id`, `title`, `hypothesis`, `implementation_plan` non vuoto, `target_rubrics` con almeno una `metric` e una `implementation`, `notes_for_agent`) + `target_rubrics.json` identico; campi mancanti o rubric sbagliate = rifiutato. "Così l'intento è un artefatto, l'esecutore non lo ricostruisce dalla conversazione" | intento ed evidenza separati | il kernel valida il bundle; il proposer non ha strumenti di esecuzione |
| Esecuzione: `program_<idx>/` append-only, mai sovrascritti; coppia atomica evaluate → verify; `rubric_status.json` per programma (`overall_pass`, rubric con `pass` ed `evidence`, `metrics`, `next_recommendation`); **budget contato in chiamate** a evaluate.py, retry inclusi; vietata ogni esecuzione esplorativa fuori dall'evaluate ufficiale; stop su `rubric_pass` o `cap_reached` | il budget e la verifica sono meccanici, non di buona volontà | `research evaluate` del kernel conta le chiamate e rifiuta oltre il budget |
| **Due cancelli indipendenti**: tutte le rubric passate = contratto completo; il best del worker cambia solo con un candidato **corretto e strettamente migliore** | | `research best` solo dal kernel |
| Worker paralleli che prendono cicli da una **coda sincronizzata**, ognuno con la sua cartella e il suo best (beam search per worker); scambio **solo a fine ciclo**: importano memoria condivisa e conclusioni degli altri, pubblicano le proprie; **potatura** periodica del contesto (ogni 20 cicli nell'esperimento RL) che archivia le storie e porta avanti il best | 2 worker: picco di 1 worker in meno di metà tempo; 4 non meglio; memoria condivisa: più veloce, finale non significativamente diverso | cicli = task della board; 2 worker di default; scambio a fine ciclo tramite lo stato curato |
| Memoria: `memory.md` per tentativo (append-only), file globale md + **JSONL autorevole**, una voce "Program Evaluations" dopo ogni coppia evaluate-verify, un `idea_evaluation_summary` a fine tentativo, conclusioni ≤ 300 parole con `gate=<updated\|kept\|skipped>; trigger=<a\|b\|c\|d\|none>; reason=…` | la memoria è un registro con un formato, non chiacchiera | diventa lo stato curato di A2: solo il kernel scrive |
| Evidenza retrospettiva: il best viene strumentato con metriche extra; dal **diff best vs iniziale** un agente propone baseline e ablation (ognuna isola **una** innovazione); un **altro agente filtra** per rilevanza, fattibilità, singola modifica; varianti `control`/`ablation`/`baseline` con CSV a schema fisso; repliche su seed; post-hoc sul programma **congelato**, controlli programmatici rifiutano ciò che riaddestra o cambia il programma | | fasi 3 e 4 |
| Scrittura: le affermazioni quantitative si risolvono **negli artefatti grezzi**, la memoria serve solo a interpretare; bibliografia **solo da query reali** (Semantic Scholar → OpenAlex → Scholar) con provenienza, lo scrittore cita solo chiavi recuperate; mappa affermazione → fonte; ciclo di riparazione con controlli deterministici + **agente di audit su copia in sola lettura** che segnala dove numeri, confronti o conclusioni esagerano | gli umani hanno comunque cambiato "significantly exceeds" in "performs on par with" e tolto citazioni sbagliate | fase 5 |
| **Guasti visti**: (1) 2 run Pi su 3 hanno cambiato la valutazione (majority voting a k campioni al posto di pass@1) e né evaluator né rubric l'hanno visto, solo un audit umano; (2) "le rubric controllano solo ciò che elencano", i vincoli non scritti passano; (3) Codex ha seguito il prompt alla lettera e non ha mai ritarato gli iperparametri dopo una modifica; (4) iperparametri aggressivi sovradattati alla validazione; (5) ri-implementazione di tecniche note scambiata per scoperta; (6) un punteggio unico nasconde compromessi | | rubric di integrità obbligatoria, kernel che sigilla, auditor che cerca i vincoli non scritti, mappa delle idee verso il lavoro precedente |
| I loro agenti: "Never ask user questions", "No user interaction" | la loro autonomia è totale fino alla fine | da noi l'utente entra ai cancelli (co-scienziato); gli agenti chiedono al lead, non all'utente, salvo i cancelli |

### 1.2 Harness-Search (A2, il motore)

- Memoria di lavoro `M = (q, P, C, I, L)`: domanda, tutto ciò che è stato trovato, evidenza curata con capacità B, direzione corrente, storia delle direzioni esplorate, fallite, aperte.
- Tre autorità separate: **proporre** (Retrieval Policy, sceglie una mossa tra search, read, redirect, curate, end), **scrivere lo stato** (Memory Operator: deduplica, giudica la rilevanza, aggiorna la direzione, valida e applica le aggiunte e rimozioni curate, rifiuta id inventati, doppioni, superamento di B; non sceglie mosse e non chiude), **chiudere** (Summary Auditor).
- **Restrizione delle mosse**: dopo S_max ricerche consecutive l'unica mossa ammessa è curate; dopo curate solo redirect o end; dopo un rifiuto dell'auditor solo redirect. Misurato: senza questo vincolo il recall crolla da 57,81 a **35,37**; S_max = 5 e T_max = 40 sono il compromesso migliore.
- L'auditor **prima sintetizza** la risposta con la sola evidenza curata, poi controlla completezza, fondatezza, coerenza; mappa ogni vincolo agli id che lo sostengono (`coverage`), elenca `missing_constraints`, dà `answer_ready` o `search_more` e in quel caso un solo `next_intent` concreto.
- Ablation: senza Memory Operator −13,07 punti di recall, senza auditor −5,74, senza giudice di rilevanza −4,83, senza pianificatore di direzione −5,23; un agente solo con gli strumenti −3,41, un agente solo con i tre ruoli nel prompt −2,46: **i ruoli devono essere componenti separati**. Costo: +13% di token sul miglior harness per +16,6% di copertura. Il modello dei ruoli ausiliari conta (il migliore: Qwen3-32B nei due ruoli).
- L'auditor recupera evidenza mancante in circa un quinto dei rifiuti: aiuta ma non garantisce.

### 1.3 PatchBoard (A2, il kernel)

- Gli agenti non si passano messaggi liberi: propongono **patch JSON** su uno stato strutturato; un **kernel deterministico** controlla sintassi, autorizzazione (contratto di scrittura per ruolo, a livello di percorso), applica su una copia, valida schema e invarianti, e solo allora fa il commit come transazione (id del worker, evento, hash della vista, patch, hash dello stato). Le patch rifiutate restano nel log con il motivo e **non toccano lo stato**.
- Operazioni ammesse: `add`, `replace` sui campi del proprio ruolo, `test` come precondizione contro le viste vecchie; `remove` solo per ruoli privilegiati.
- **Viste limitate per ruolo**: il budget di contesto più piccolo provato (1k caratteri) ha il miglior rapporto successo/costo; più contesto non migliora e costa di più. Le collezioni grandi diventano riassunti con id stabili; chi ha bisogno di più chiede di espandere un id.
- **Circuit breaker** deterministico: patch invalide consecutive, proposte che non cambiano nulla, stati ripetuti (finestra di 3 hash, soglie 2 e 4) → riprova, riparazione, cambio di worker, vista più stretta, stop.
- Fault injection: contaminazione 0 per JSON invalido, percorsi sbagliati, scritture non autorizzate; **ma i falsi claim passano nel 43% dei casi** (validi per lo schema): la verifica semantica resta all'auditor.
- Lo schema specifico del compito (scritto dall'Architect e validato contro un meta-schema) batte uno schema fisso.

### 1.4 MemTX (A2, la vita di un dato)

- "Una scrittura non è una credenza." Ogni record ha fonte con peso di autorità, permessi, **archi di derivazione** (DAG), tipo (credenza, riassunto, azione...), validità, fiducia.
- Ciclo di vita: raw → tentative → validated → committed → action-safe, più quarantined, superseded, revoked; ogni altra transizione è rifiutata.
- Commit in quattro controlli: evidenza (fiducia ≥ 0,6 salvo fonte ≥ 0,9), validità nel tempo, conflitto sullo stesso slot (un rivale committato dopo lo snapshot = scrittura tardiva, abortita), stabilità delle dipendenze (niente antenati in revoca).
- Le **azioni irreversibili** passano solo se non ci sono record in sospeso e (al livello più alto) se lo snapshot ha record action-safe.
- **Ritiro a cascata**: revocare un record revoca le credenze derivate, mette in quarantena riassunti e copie, segna le azioni come da compensare.
- Problema aperto dichiarato: un agente che **trascrive senza dichiarare la fonte** sfugge a tutto. Da noi: niente commit senza fonte.

---

## 2. Il progetto adattato alla chatroom

### 2.1 I ruoli e i modelli

**Stile `core` (default): 5 agenti, Propose → Commit → Audit**

| Ruolo | Modello (proposta) | Autorità | Fa | Non può |
|---|---|---|---|---|
| PROPOSER | Sonnet, xhigh | proporre idee | bundle di idea in sola lettura, a turno in modo *gap* e *analogia* | eseguire codice, scrivere lo stato |
| WORKER-1 | Sonnet, xhigh | proporre evidenza | prende un ciclo dalla board, lavora sul suo ramo git, `program_<idx>` append-only, chiede `research evaluate` al kernel | leggere i rami e la chat grezza degli altri; scrivere lo stato |
| WORKER-2 | Haiku, max | proporre evidenza | come WORKER-1 | idem |
| REGISTRAR | Haiku, max | operazioni di memoria | rilevanza delle evidenze proposte, aggiornamento della direzione (formato di Harness-Search: `active_direction`, `searchable_directions`, `no_positive_feedback_directions`, `completed_directions`, `change_summary`), conclusioni distillate di fine ciclo | scegliere idee, chiudere; ogni sua uscita passa dal kernel |
| AUDITOR | Sonnet, xhigh | chiudere | alignment judge nel drafting, verdetti ai cancelli e sulle chiusure, filtro delle ablation, audit del report; cerca cambi di protocollo e vincoli non scritti | proporre idee, eseguire |
| kernel | `chat.py`, deterministico | scrivere lo stato | valida e applica ogni proposta, lancia gli evaluator, conta i budget, tiene il log | — |
| LEAD | modello della sessione | orchestrare | assegna i cicli, scrive i prompt con `chat.py prompt`, parla con l'utente | scrivere lo stato direttamente |

Sulla tua composizione (3 Sonnet xhigh + 2 Haiku max): va bene, e l'assegnazione sopra è quella che i paper giustificano. I tre ruoli dove il modello pesa di più sono il proponente (la novità è il punto debole degli agenti: le idee generate restano vicine alla letteratura di partenza), un worker (la Sakana trova che nell'investigazione il modello conta più dell'harness) e l'auditor (è lui che deve accorgersi del cambio di protocollo che alla Sakana è sfuggito). Il REGISTRAR può essere Haiku perché il controllo vero lo fa il kernel; Harness-Search mostra però che il modello della memoria incide: se le direzioni ristagnano è il primo da alzare. WORKER-2 su Haiku costa meno e porta varietà; se i suoi tentativi falliscono spesso, conviene metterlo su Sonnet e togliere il secondo worker invece di tenerlo debole.

**Numero di worker: 2 fissi.** È il picco misurato dalla Sakana (2 worker raggiungono il risultato di 1 in meno di metà tempo; 4 non fanno meglio). Un terzo worker si evoca solo dopo l'ok dell'utente, in un ciclo che lo giustifica (per esempio una direzione indipendente rimasta aperta in `history`).

**Squadra di ricerca web: 5 Haiku max** (le ricerche su internet, non il codice)

È il ciclo di Harness-Search applicato alla letteratura, cioè il caso per cui quel paper è nato:

- 5 ricercatori Haiku max, ciascuno su un filone diverso (assegnato dal lead dalla lista `searchable_directions`), con le mosse search, read, redirect, curate, end; dopo S_max = 5 ricerche consecutive l'unica mossa ammessa è curate (senza questo vincolo il recall del paper crolla da 57,81 a 35,37).
- Le fonti che propongono passano dal REGISTRAR e dal kernel come ogni evidenza: id stabile, link, data, cosa dimostra, deduplicate; capacità B. Una fonte senza link aperto davvero non entra (il problema della trascrizione senza fonte di MemTX).
- Chi chiude è l'AUDITOR Sonnet, non un Haiku: sintetizza con le sole fonti curate, mappa ogni domanda alle fonti che la coprono, dà `answer_ready` oppure `search_more` con un solo `next_intent`.
- Quando entra: fase 0 (stato dell'arte, baseline, cosa esiste già), fase 2 su richiesta del PROPOSER (verifica che un'idea non sia una tecnica nota: riempie il campo `prior_work`, il guasto 5 della Sakana), fase 5 (bibliografia da query reali, mappa affermazione → fonte). Finestra temporale e fonti ammesse le fissa il contratto.
- Da verificare prima di implementare: se Haiku accetta l'effort `max`.

**OpenRouter** (solo critiche finali e brainstorming): tutti i modelli gratuiti disponibili al massimo ragionamento, con priorità ai più grandi e agli "stealth"; entra come strumento dell'AUDITOR nella fase 5 (critiche al report) e del PROPOSER in modalità brainstorming. Progetto a parte, nella lista harness.

### 2.2 Lo stato della ricerca

`ROOM/research/state.json`, scritto **solo** dal kernel; ogni modifica è una transazione in `ROOM/research/log.jsonl` (chi, quale proposta, hash della vista, patch o motivo del rifiuto, hash dello stato dopo).

```
task        contratto: sezioni di task.md, hash dei file sigillati, budget, fase corrente
queue       cicli da fare / in corso / fatti (sono anche task della board)
ideas[]     bundle validati: id, titolo, ipotesi, piano, rubric, modo (gap|analogia), autore, ramo
attempts[]  P: tutti i tentativi, append-only: idea, worker, program_idx, commit git, metrics,
            correct, rubric_status, chiamate di evaluate usate, stato del record
curated[]   C: evidenza accettata (capacità B), ognuna con fonte obbligatoria (attempt, ablation,
            final, artefatto, riferimento) e stato (tentative|committed|quarantined|revoked)
best        per worker e globale: solo correct e strettamente migliore
direction   I: filone corrente e le ricerche suggerite
history     L: direzioni esplorate, fallite, aperte, con il motivo (il gate della Sakana)
gaps[]      buchi lasciati dall'auditor, il primo è il next_intent
conclusions conclusione distillata per worker (≤ 300 parole) con gate e motivo
derives     archi di derivazione: conclusione ← evidenze ← attempt ← idea
```

**Contratti di scrittura** (come PatchBoard): il PROPOSER aggiunge solo in `ideas`; i WORKER solo proposte di attempt (che il kernel trasforma in record dopo l'evaluate); il REGISTRAR propone `curated` (aggiunte e rimozioni), `direction`, `history`, `conclusions`; l'AUDITOR scrive solo verdetti e `gaps`; nessuno cancella: solo il kernel cambia lo stato di un record.

**Ciclo di vita** (come MemTX, ridotto): ogni record nasce `tentative`, diventa `committed` quando il kernel lo accetta, `quarantined` se un controllo fallisce (con il motivo), `revoked` se l'auditor o l'utente lo ritirano. Il ritiro **va a cascata** lungo `derives`: un attempt revocato (es. protocollo cambiato) ritira le evidenze curate che ne derivano, mette in quarantena le conclusioni che le usavano e riapre il best se era lui. Le "azioni irreversibili" della ricerca (passaggio di fase, `research final`, chiusura del report) passano solo se nessun record da cui dipendono è in sospeso.

**Viste limitate**: ogni agente riceve `research view --as NOME`, costruita dal kernel con il suo contratto di lettura e un budget piccolo (punto di partenza 2k caratteri, PatchBoard: 1k il migliore); le collezioni lunghe diventano riassunti con id, e `research expand ID` apre un record. I WORKER vedono il compito, la loro idea, il best del loro ramo, le conclusioni degli altri dell'ultimo ciclo, i `gaps`; non la chat completa degli altri.

### 2.3 Il ciclo e le restrizioni sulle mosse

1. Il lead mette in coda un ciclo; un WORKER lo prende (`task take`).
2. PROPOSER: bundle → il kernel lo valida (campi, ipotesi, rubric `metric` + `implementation` + la rubric di integrità obbligatoria, id esistenti, **non troppo simile** a un'idea in `history`) → `ideas`.
3. WORKER: modifica `program_<idx>` nel suo ramo; `research evaluate` → il kernel controlla il sigillo, lancia l'evaluator con timeout e conta la chiamata, scrive metrics, correct, `rubric_status`, commit git del tentativo → record in `attempts`. Coppia evaluate → verify atomica, stop su rubric tutte passate o budget finito (i limiti della Sakana).
4. **Dopo S tentativi senza nessuna evidenza proposta e accettata** (S = 5 come Harness-Search, da tarare) l'unica mossa ammessa al worker è proporre evidenza o chiedere un cambio di direzione; il kernel rifiuta le altre.
5. REGISTRAR a fine ciclo: rilevanza delle evidenze proposte, curate, direzione, conclusione del ciclo (gate a/b/c/d). Il kernel le applica.
6. **Circuit breaker**: proposte invalide consecutive, tentativi identici, stati ripetuti → riprova, cambio di worker, stop del ciclo, avviso al lead.

### 2.4 Le fasi e i cancelli

| Fase | Agenti | Cancello |
|---|---|---|
| 0. Contratto | lead + utente in chat | l'utente approva `task.md` |
| 1. Drafting | WORKER-1 scrive programma iniziale, evaluator di ricerca e finale, rubric; un secondo agente rivede il design prima del codice; il kernel fa smoke test e prova a carico pieno | AUDITOR (alignment judge: fedeltà, dati disgiunti, rubric di integrità presente) **e** utente → `research seal` |
| 2. Investigation | PROPOSER, WORKER ×2, REGISTRAR | budget di cicli finito o tutte le rubric passate; AUDITOR conferma completezza, fondatezza, coerenza (formato di Harness-Search: `coverage`, `missing_constraints`, `verdict`, `next_intent`); se rifiuta, il buco va in `gaps` e il ciclo dopo può solo cambiare direzione |
| 3. Evidenza (ablation e baseline) | dal diff best vs iniziale un agente propone, l'AUDITOR filtra (rilevanza, fattibilità, una sola modifica), i WORKER eseguono con repliche | tabella con repliche, oppure fase *degraded* |
| 4. Final + post-hoc | il kernel lancia il final evaluator una volta sola sui dati che nessuno ha visto; post-hoc solo su artefatti del programma congelato | risultati registrati |
| 5. Report | uno scrittore (un WORKER) con bibliografia da query reali; AUDITOR su copia in sola lettura; facoltativo: critiche dal pannello OpenRouter | ogni affermazione risolve a un id di `curated`; l'utente approva |

### 2.5 La rubric di integrità e i controlli contro i guasti visti

- Rubric `protocol_integrity` obbligatoria in ogni contratto: "la procedura di valutazione (seed, numero di campioni, metrica, split) non cambia". Il kernel la verifica da sé: i file dell'evaluator sono sigillati e il candidato non può toccarli; l'AUDITOR legge `verify.md` e il diff di ogni attempt che migliora il best cercando cambi di procedura dentro il programma (il caso Pi: majority voting implementato nel codice del candidato).
- Il kernel rifiuta il passaggio alla fase 3 se il best non ha superato la rubric di integrità.
- Ogni idea del PROPOSER porta un campo `prior_work` (tecnica nota da cui parte, o "nessuna nota"): è la mappa delle idee verso il lavoro precedente che la Sakana indica come mancante.
- Il punteggio unico non basta: il contratto dichiara anche le metriche secondarie (compromessi) che il report deve riportare.

### 2.6 Comandi nuovi di `chat.py` (CLI e MCP)

`research init` · `research view` · `research expand ID` · `research propose-idea` · `research evaluate` · `research propose-evidence` · `research registrar` (direzione, curate, conclusione) · `research audit` (verdetto) · `research revoke ID` · `research phase next` · `research seal` · `research final` · `research status` · `prompt RUOLO`. Tutti passano dal kernel; le proposte sono JSON validati contro lo schema della fase.

---

### 2.7 Cosa il kernel research eredita dalle correzioni già nella stanza normale

Le correzioni dei 5 report ([correzioni-harness.md](correzioni-harness.md)) sono già nel `chat.py` di tutte le stanze; il kernel research le riusa invece di rifarle:

| Già nella stanza normale | Nel kernel research diventa |
|---|---|
| `task add --verify CMD` (solo lead/utente), `done` che lo esegue e rifiuta se esce ≠ 0, prova con exit code e hash | `research evaluate`: l'evaluator sigillato lanciato dal kernel, chiamate contate nel budget |
| prova con artefatto obbligatoria, `--gaps` | `rubric_status` con `evidence` per rubric; i gap restano nel record |
| `--merge-into` con `git merge-tree` | ramo per idea (A4): il best si integra solo se si fonde pulito |
| lease dei task, `task next` | coda dei cicli: un ciclo abbandonato torna in coda, il worker pesca il prossimo |
| `CLOSED` solo con tutti i sì motivati, `no` = revisione del LEAD, tetto a `PLAN v3` | cancelli di fase: verdetto dell'AUDITOR con `coverage`; disaccordo = revisione del LEAD; tetto ai cicli di revisione del report |
| voto girato senza prova, stallo (stessa % e stesso `next`), budget di chiamate in `check` | circuit breaker del kernel (proposte invalide, stati ripetuti, budget per ruolo) |
| `wait --focus` e ALERT solo a chi riguarda, riassunti dallo stato, `read --range` | viste limitate per ruolo, `research expand ID` |
| lock con proprietario, wait MCP annullabile, tetto Codex 50 s | lo stesso server e lo stesso lock per `state.json` |
| regola 6 (si cambia idea solo con prova nuova), prima posizione indipendente | prompt di PROPOSER e AUDITOR |

Limiti che il kernel non deve ereditare (revisione 1): "solo lead" è un nome, non una capacità, quindi le azioni del lead si fanno solo da shell e mai via MCP; piani, voti e chiusure in research vanno registrati come dati strutturati dal kernel, non riconosciuti nel testo della chat; `--focus` riduce la lettura ma non è un controllo d'accesso (`read --all` vede tutto), quindi non protegge un evaluator sigillato: lo protegge l'hash; i CHECK segnalano e non bloccano, il circuit breaker del kernel invece rifiuta; una valutazione lunga deve risultare attività (oggi `research evaluate` scrive una riga "running" prima di partire).

### 2.8 A3-A8 adattati (paper letti per intero)

**A8, il primo passo che si costruisce: ciclo alla autoresearch** (Karpathy, `program.md`)
- Contratto minimo: un solo file modificabile, l'evaluator e le costanti in un file in sola lettura, un budget di tempo fisso per ogni run (lì 5 minuti; oltre il doppio la run si uccide e conta come fallita), nessuna dipendenza nuova.
- Ciclo: modifica → commit → run con l'output in un file (mai in contesto) → si legge solo la metrica → se migliora il ramo avanza, altrimenti `git reset`. Crash: si corregge se è banale, altrimenti `crash` e si passa oltre.
- Registro `results.tsv`: commit, metrica, memoria, stato `keep|discard|crash`, descrizione. **Da noi lo scrive `chat.py`, non l'agente**: è il primo pezzo del kernel (`research evaluate` = `task --verify` con budget e registro).
- Criterio di semplicità nel contratto: a parità di risultato vince il codice più corto; togliere codice senza peggiorare è un successo.
- Differenze volute: autoresearch dice "non fermarti mai, non chiedere"; da noi il budget lo fissa il contratto, e gli agenti chiedono al lead, non all'utente.
- Serve per provare kernel, registro e prompt su un caso piccolo prima di A1 completo (1 worker + lead + utente).

**A5, stati recuperabili** (ScienceFlow, [2608.14354](https://arxiv.org/abs/2608.14354))
- Ogni `research evaluate` è un *cancello di tappa*: il kernel crea un tag git `att-<n>`, salva la scheda del risultato (metodo, metrica, artefatti, costo) nel registro. Git conserva solo le differenze: ScienceFlow con stati a delta passa da 2204,6 a 189,2 GiB (−91,4%) e senza delta perde 11 punti per limiti di spazio. Gli artefatti grandi (checkpoint, dati) restano fuori da git, con un riferimento.
- **Confine di segmento**: per un worker è la fine del suo turno (il report finale del subagent) o il contesto quasi pieno. Lì il worker propone una decisione strutturata, validata dal kernel: `{anchor: current | att-<n>, direction: extend | redirect, bottleneck, supporting_evidence: [id], decision_reason, next_search_focus}`. Quattro esiti: proseguire o cambiare strada, dallo stato attuale o da uno salvato. Il kernel controlla che l'ancora esista e sia `correct`, poi ricrea il ramo da quel tag.
- Memoria come in ScienceFlow: *Add* (una scheda per tappa), *Fold* (sopra un budget, restano per intero le recenti, la migliore e quelle dell'ancora; le altre diventano riassunti con id), *Unfold* = `research expand ID`. Il ramo abbandonato viene "piegato" in evidenza chiusa con la voce "da non ripetere".
- Misurato: senza ESTRA 66,67% contro 80,30% di medaglie (MLE-bench Lite, 24 h); la scelta storica dell'ancora era la migliore in 5 decisioni su 7 rigiocate.
- Controllo dell'esecuzione (versione leggera): un job lungo dichiara il tempo atteso; se lo supera senza produrre metriche o artefatti nuovi, il kernel lo ferma e lo restituisce al worker (`STOP_AND_REPLAN`), oppure concede una finestra a tempo legata a una condizione misurabile (`TIMEBOX`). Senza questo controllo 69,70% contro 80,30%.
- Prompt in ordine fisso, prima la parte stabile (ruolo, regole, strumenti, contratto) e poi quella che cambia (ancora, direzione): cache dei prompt, ed è già il modo in cui lavora `chat.py prompt`.

**A4, un ramo per idea e il lead come pastore** (SwarmResearch, [2607.02807](https://arxiv.org/abs/2607.02807))
- Ogni ciclo lavora su un ramo nuovo con nome neutro (`r-17`), da `main` (idea da zero), dal tag di un attempt (continuazione) o dall'unione di più genitori (combinazione: un solo programma attivo, gli altri salvati come file di riferimento).
- Il lead sceglie **genitore e tipo di worker**, mai l'idea: *explorer* = agente nuovo a contesto pulito, una sola idea, poi riassunto; *optimizer* = lo stesso agente che continua (SendMessage), al massimo 5 valutazioni, reset se non migliora, uno solo vivo per genitore.
- Contesto per livelli: il worker vede solo il suo ramo e il `findings.md` della sua discendenza (fatti neutri, niente "prossimi passi"); la visione globale l'hanno lead, REGISTRAR e AUDITOR. Il motivo: in CORAL, con la memoria condivisa da tutti, gli agenti abbandonano le direzioni indipendenti appena uno trova di meglio. Questo **cambia A1**: le conclusioni degli altri worker non entrano più a ogni inizio ciclo; entra solo la lista di cosa non ripetere e, sui plateau, un briefing di punti forti e deboli senza indicare la soluzione.
- Esempio buono di contesto (dal loro prompt): "il genitore fa 0,78 ma viola i vincoli nei casi limite; un altro ramo fa 0,79 con un'altra famiglia, migliore sui vincoli ma meno preciso: usa questi compromessi per decidere". Esempio vietato: "prova un beam search con larghezza 8-32".
- Prima largo poi profondo: i primi cicli explorer da `main`, poi optimizer sulle 2 famiglie migliori; sul plateau di nuovo explorer da `main`. Un ciclo 0 facoltativo solo di analisi (profilare il programma iniziale senza proporre soluzioni) rende le idee più motivate.
- Commit con formato fisso `descrizione | score = X`. Misurato: diff 3,2 volte più ampi di CORAL e 1,7 di EvoX (più cambi di approccio), 13/15 compiti vinti o pari.
- Limite dichiarato: il pastore tende a concentrarsi su una sola famiglia e a suggerire idee anche quando glielo si vieta; le idee "nuove" non sostenute dai dati sono il rischio principale. Da noi: la scelta del genitore resta del lead, ma il kernel rifiuta un ciclo se le ultime 4 scelte partono tutte dalla stessa famiglia senza un explorer da `main`.

**A3, contro il restringimento delle idee** (Narrow Exploration, [2605.27905](https://arxiv.org/abs/2605.27905))
- Dati: su 219.655 idee (5 framework, 5 LLM), quelle degli agenti sono più concentrate (ampiezza 0,554 contro 0,599), più vicine alla letteratura di partenza (0,322 contro 0,410), coprono meno il fronte dell'anno dopo (28,5% contro 36,5%); il 90,4% cambia il metodo, solo il 10,5% la domanda. Prompt che chiedono novità, auto-riflessione, tornei e dibattiti non chiudono il divario; l'accesso alla letteratura riduce un po' la distanza (lo zero-shot senza ricerca è il peggiore).
- Quindi **niente fiducia nel prompt, controllo nel kernel**:
  - modi del PROPOSER imposti a turno dal kernel: *gap* (cosa manca) e *analogia* (soluzioni di altri campi);
  - campo `changes: question | method | both`; almeno 1 idea accettata su 4 deve cambiare la domanda (o una sotto-domanda), altrimenti il kernel chiede la prossima in quel modo;
  - filtro di somiglianza deterministico (solo libreria standard): trigrammi di parole di titolo + ipotesi + piano, Jaccard contro ogni idea in storia; sopra 0,5 rifiutata con l'id più vicino;
  - misure in `research status`: ampiezza (distanza media tra le idee accettate) e distanza dal punto di partenza (il `task.md`), così il lead vede il restringimento mentre succede;
  - `prior_work` riempito dalla squadra web, che è proprio la leva che il paper trova utile.
- Come in SwarmResearch: al PROPOSER si dice cosa non ripetere, mai cosa fare.

**A6, i detector della ricerca** (Sakana + Evolutionary coding agents, [2605.20086](https://arxiv.org/abs/2605.20086))
- *Sigillo*: hash dei file dell'evaluator a ogni `evaluate`; se cambia, l'attempt è revocato a cascata.
- *Protocollo*: l'evaluator stampa la sua configurazione (seed, numero di campioni, metrica, split); il kernel la confronta con il contratto. Per i cambi dentro il programma (il caso Pi: voto a maggioranza su k campioni al posto di pass@1) l'AUDITOR legge il diff di ogni attempt che migliora il best.
- *Best senza `correct`*: impossibile per costruzione (solo il kernel scrive il best).
- *Ciclo di righe*: in media il 30% delle righe aggiunte dagli agenti evolutivi sono identiche byte per byte a righe che la stessa discendenza aveva cancellato, in media dopo 5 iterazioni, e la quota cresce in 118 run su 121. Detector deterministico sulla catena di diff del ramo; sopra la soglia, `check` lo segnala e il prossimo prompt del worker riceve la lista delle righe già tolte.
- *Solo taratura*: un diff che cambia solo letterali numerici è "taratura". Nel paper è il tipo più frequente ma il meno utile; aiutano di più dipendenze esterne (odds 3,58), efficienza (1,61), cambi di architettura (1,55). Se la quota di sole tarature supera la metà, il lead manda un explorer.
- *Soffitto della taratura* (fase 3): una baseline che tara i parametri del programma iniziale con lo stesso budget (nel paper 24 chiamate di ottimizzazione bayesiana raggiungono il best finale in 13 casi su 15). Se la raggiunge, il guadagno non è strutturale e il report lo dice.
- *Sovradattamento*: in 2 framework su 4 il punteggio pubblico peggiora su quello privato in almeno il 30% dei problemi. Da noi il final evaluator una volta sola (fase 4) e il report mostra entrambi i numeri.
- *Riproducibilità*: rifacendo lo stesso prompt si recupera in media il 76% del guadagno con un programma diverso: le repliche multi-seed della fase 3 sono obbligatorie per ogni affermazione.

**A7, rubric dell'AUDITOR per fase e checklist del report** (ARAC-Bench, [2608.12788](https://arxiv.org/abs/2608.12788); survey sul verification gap, [2608.05179](https://arxiv.org/abs/2608.05179))
- Punteggio a tre ancore per ogni voce: 0 (assente o sbagliato), 1,5 (citato senza giustificazione), 3 (corretto e necessario nella catena logica). Le voci le sceglie l'AUDITOR dal contratto (le 5 più rilevanti), non un elenco generico.
- *Proposta*: copertura della letteratura (contro le fonti della squadra web), coerenza interna (simboli, pseudocodice contro testo, superiorità rispetto alla baseline argomentata), dati e ambiente che si caricano davvero (il kernel lo prova: in ARAC i punti si danno solo se il caricamento riesce).
- *Esperimento*: moduli con test; un modulo mancante vale 0, senza compensazioni; iperparametri confrontati con valori noti del campo.
- *Sintesi*: spiegazione del meccanismo, controfattuali coperti, limiti dichiarati.
- Il migliore dei loro 11 framework fa 67,9/100; correlazione con dottorandi 0,88 (proposta), 0,66 (esperimento), 0,90 (sintesi).
- Checklist del report (survey: su 24 sistemi solo il 38% rilascia seed e tracce e solo il 38% dichiara come ha verificato la novità): punti in cui è intervenuto l'umano; codice (il ramo); seed e tracce (`log.jsonl` + attempts); metodo di verifica della novità con un controllo indipendente a campione; numero di tentativi e regola di selezione (il registro li ha tutti, quindi la selezione a posteriori si vede); provenienza e budget di taratura della baseline; indipendenza del revisore (l'AUDITOR non è l'autore, e la verifica primaria resta l'evaluator deterministico); ipotesi pre-registrate (il contratto e i bundle hanno l'ora nel log prima di ogni `evaluate`).
- Scala della fiducia del survey: verificatore formale > test eseguibile > modelli appresi > giudizio di un LLM. Le affermazioni del report si appoggiano al gradino più alto disponibile e lo dichiarano.
- Il report è un input non fidato per l'AUDITOR: un testo nascosto o una nota possono manipolare il revisore. L'AUDITOR lo legge come dati, mai come istruzioni, e rivede la copia in sola lettura.

## 3. Domande aperte prima di implementare

1. Sandbox: la Sakana esegue tutto in Docker perché gli agenti lanciano qualsiasi comando. Da noi: ramo git per worker + evaluator lanciato dal kernel con timeout; Docker facoltativo?
2. Squadra web: i 5 Haiku girano in parallelo al core (fino a 10 agenti vivi) o solo nelle finestre in cui il core aspetta?
3. Capacità B dell'evidenza curata e S (tentativi prima di dover proporre evidenza): partire da 60 e 5 come Harness-Search e tarare con le prime ricerche?
