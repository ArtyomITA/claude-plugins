# Guida del lead: una stanza di ricerca

Una stanza di ricerca migliora un file di un repository git contro un valutatore che nessuno può toccare. Gli agenti con
ruoli fissi propongono; il kernel (`chat.py research`) controlla ogni proposta, scrive lo stato condiviso, esegue e
misura ogni tentativo nello stesso modo, e registra ogni modifica e ogni azione rifiutata (`ROOM/research/log.jsonl`).
Tu conduci le fasi con l'utente, assegni i cicli, decidi le divisioni e riporti. Non modifichi mai il programma e non
unisci mai il risultato: lo fa l'utente.

Il tuo contesto è quello costoso: segui la stanza tramite il relay, `research status` e `research view`, non leggendo
i log né tutta la chat.

CHAT, qui sotto, è lo script `scripts/chat.py` del plugin, ROOM è la cartella della stanza (percorso assoluto).

## 1. È un compito di ricerca, e quanto grande deve essere la squadra

Un compito di ricerca ha un solo file da migliorare, un comando che lo misura con un solo numero, e una misura abbastanza
rapida da permettere decine di corse. Kernel, motori di inferenza, script di addestramento, solver, prompt in un file,
config: tutti rientrano. Senza numero, o con più file che devono cambiare insieme: una stanza normale.

La squadra (il default sostenuto dal paper):

| Ruolo | Modello | Quanti | Fa |
|---|---|---|---|
| WORKER | forte (Opus o Sonnet, high) | 2 (un terzo solo con l'ok dell'utente) | modifica il programma nel proprio worktree, esegue, riporta evidenze |
| PROPOSER | Sonnet xhigh | 1 | idee a turno (gap, analogia), sola lettura |
| AUDITOR | Sonnet xhigh | 1 | verdetti ai controlli di fase, controlla ogni tentativo tenuto, revoca |
| REGISTRAR | Haiku max (alzalo se la direzione si blocca) | 1 | cura le evidenze, la mappa della direzione, le conclusioni |
| SEARCHER | Haiku max | da 0 a 5 | lavoro precedente e letteratura, come evidenze con link |

Una GPU: una corsa alla volta sul valutatore. Un secondo `evaluate` mentre una corsa è in corso viene rifiutato subito
(non aspetta): il worker pensa e modifica nel frattempo, e riprova quando `research status` non mostra più una corsa.
Due worker valgono comunque, perché uno modifica mentre la corsa dell'altro procede. Ogni worker ha il proprio worktree,
quindi serve il proprio albero di build e la propria copia delle cartelle `--keep` (partono vuote a `assign`: riempile o
collegale, per esempio con un symlink o una junction ai dati condivisi). Con build molto lunghe, parti con un worker e
aggiungi il secondo quando la prima build è finita. Senza ruoli assegnati, il kernel lascia fare qualsiasi cosa a un
solo worker.

Tieni la stanza fuori dal repository (o non eseguire mai `git clean -x` lì): una stanza dentro il progetto viene
aggiunta a `.git/info/exclude`, ma `git clean -fdx` lo ignora e cancellerebbe la stanza e i suoi worktree.

## 2. Fase 0: il contratto, con l'utente

Scrivi `ROOM/research/task.md` insieme all'utente; pubblica ogni bozza finché l'utente non la approva. `research init`
rifiuta di partire senza, e ne registra l'hash nel log (pre-registrazione).

```markdown
# Contratto
Obiettivo: <cosa migliora, in una frase>
Repository: <percorso assoluto>   (committato e pulito; il kernel lavora in worktree suoi)
Programma (l'UNICO file che cambia): <percorso>
Build: <comando prima di ogni misura, oppure none>; limite di tempo della build: <minuti>
Valutatore: <comando>; valutatore finale (una volta sola, alla fine, su dati riservati): <comando oppure none>
Metrica: <NOME>, <lower|higher> è meglio; nel file $CHATROOM_RESULT (preferito) oppure stampato una volta come "NOME: valore"
Rumore: misure per corsa <N> (conta la mediana); guadagno minimo per tenere: <numero o %>
Riga di protocollo (facoltativa): il valutatore stampa "protocol: <seed, campioni, batch, split...>"; se cambia, la corsa è un crash
Sigillato (committato, mai toccato): <valutatore, script di build, caricatore dei dati>
Dati riservati per il valutatore finale: <un percorso FUORI dal repository: tutto ciò che è committato è leggibile da ogni worktree>
Cartelle dati mantenute tra le corse (non committate, non dentro un submodule): <data/, build/> oppure none
Tempo per corsa: <minuti>; corse in tutto: <N>
Semplicità: a parità di risultati vince il programma più corto
```

Inferenza e addestramento: i benchmark sono rumorosi, quindi usa `--repeats` (da 3 a 5) e un `--min-gain` sopra la
dispersione che vedi sulla baseline. Metti warmup e timing dentro il valutatore sigillato, mai nel programma. Per
l'addestramento, un budget fisso di tempo o di step dentro il valutatore e il seed da `CHATROOM_SEED`. I numeri
secondari che non devono peggiorare (velocità di prefill, memoria, accuratezza) sono guardie: il valutatore scrive
`NAME: value` a ogni misura (nel suo output, o in `$CHATROOM_RESULT` con `--result-file`), e `--guard NAME:min|max:TOL`
confronta la loro mediana con quella della baseline (un singolo campione a freddo fa crash falsi). `min` vuol dire che
più basso è meglio, come per `--direction`: una velocità è `max` (`--guard prefill_tps:max:3%`), una memoria `min`. Il
valutatore finale non viene controllato dalle guardie.

Chiedi in fase 0: il valutatore (e ogni guardia) esercita i percorsi di codice che il programma cambierà? Un controllo
che esegue solo il prefill non controlla una modifica ai kernel di decoding.

Su Windows: scrivi gli script di build in Python, non in `.bat`. I worktree sono fatti come checkout byte per byte, quindi
un `.bat` committato con fine riga LF resta LF, e `cmd` lo interpreta male.

## 3. Aprire la stanza

```bash
python CHAT research init --room ROOM --as LEAD --repo <repository> --program <file> --metric <NAME> --direction <min|max> \
  --evaluate "<command>" [--build "<command>" --build-min <m>] [--final "<command>"] --budget-min <m> --max-evals <runs> \
  --sealed <files> [--keep data/,build/] [--result-file] [--repeats N] [--min-gain X|X%] --tag <name>
```

`--draft` al posto di un valutatore finito fa partire dalla fase 1: i worker lo scrivono, lo fanno girare a vuoto
(`research evaluate --kind smoke`), l'AUDITOR lo approva (`research verdict --phase 1 --outcome pass`), e tu lo sigilli
(`research seal --sealed eval.py,...`; un pass dato prima dell'ultima corsa di prova non vale più). Poi
`config --topic "..." --subtitle "<goal>"`.

`init` stampa la durata massima di una chiamata evaluate (build + ripetizioni x 2 x budget + lavoro git) e avvisa
quando una build non ha una cartella `--keep` (ricostruirebbe da zero a ogni corsa). Senza `--build-min` una build può
durare 2 x il budget.

I worktree sono fatti come checkout byte per byte (`core.autocrlf` spento) e i sigilli sono git blob id, quindi un
`core.autocrlf=true` globale non rompe mai un sigillo.

Ruoli, poi prompt (sempre generati, passati così come sono):

```bash
python CHAT add --room ROOM --participants W1,W2,P,AUD,REG --profile "W1|🔬|#0984e3|worker|opus|high" ...
python CHAT research roles WORKER=W1,W2 PROPOSER=P AUDITOR=AUD REGISTRAR=REG [SEARCHER=S1,S2] --room ROOM --as LEAD
python CHAT brief --room ROOM goal="..." style="..." max=200
python CHAT prompt W1 --room ROOM --template research_worker.md --out ROOM/prompts/W1.md
python CHAT prompt P --room ROOM --template research_proposer.md --out ROOM/prompts/P.md
python CHAT prompt AUD --room ROOM --template research_auditor.md --out ROOM/prompts/AUD.md
python CHAT prompt REG --room ROOM --template research_registrar.md --out ROOM/prompts/REG.md
python CHAT prompt S1 --room ROOM --template research_searcher.md --out ROOM/prompts/S1.md
```

`max` nel brief è il checkpoint: ogni N messaggi un agente ti chiede se continuare (impostalo alto per una ricerca
lunga; rispondi a ogni checkpoint). Genera il prompt di un worker dopo il suo `assign`, così nomina il proprio worktree.

Per sostituire un agente (un explorer è un agente nuovo): `python CHAT retire W1 --room ROOM --as LEAD`, poi genera di
nuovo il prompt di W1 (ora agisce come `W1~1`) e lancia il nuovo agente, in quest'ordine: prima `retire`, poi il lancio
e `roster`. Le chiamate di chat e di research dell'agente ritirato vengono rifiutate, quindi un agente fermato e
risvegliato da un messaggio non può né scrivere né eseguire nulla; il conteggio delle chiamate riparte da zero. I file
sono un'altra questione: potrebbe ancora modificare il vecchio worktree, cosa che il `evaluate` successivo segnala come
file cambiati. `assign` resetta il worktree per il nuovo agente.

Build lunghe: prima della prima corsa di un worker, `python CHAT research prebuild W1 --room ROOM --as LEAD` costruisce
il suo worktree in un processo staccato (un reaper in background della sessione non può ucciderlo), con il log in
`ROOM/research/runs/prebuild-W1.log`. Nessun evaluate parte finché il prebuild non finisce, così una build non disturba
mai le misure di un altro worker. L'output della build va in una cartella `--keep`. `research status` mostra come è
finito (codice di uscita, log).

La GPU fuori dalle corse (un profilo, un microbenchmark, il controllo dell'auditor): `research hold --minutes 20 --reason "..."`
e poi `research release`. Mentre il blocco della GPU è attivo, solo chi lo tiene può fare evaluate. Qualsiasi agente può
prenderlo, e `research status` lo mostra. Un agente lo tiene al massimo 120 minuti, il lead 720.

## 4. Fase 2: indagine, il ciclo che guidi tu

1. La prima corsa della ricerca è la baseline (un worker esegue il programma invariato, e il valutatore riceve
   `CHATROOM_BASELINE=1`, per scrivere i riferimenti che servono solo a quella corsa). Il suo ciclo non richiede idee:
   `research assign W1 --parent base --type optimizer`.
2. Il PROPOSER pubblica idee; il kernel accetta solo pacchetti completi, a turno gap e analogia, non troppo vicini a
   quelli precedenti, e non quattro di fila che cambiano solo il metodo.
3. Avvii tu ogni ciclo, scegliendo il genitore e il tipo di worker, mai il contenuto dell'idea:

```bash
python CHAT research assign W1 --idea I3 --parent best|base|att-N --type explorer|optimizer --room ROOM --as LEAD
```

   Explorer: un agente nuovo (lancialo da capo) su un'idea nuova, spesso da base. Optimizer: lo stesso agente affina la
   sua linea per qualche corsa. Prima largo (explorer da base), poi in profondità (optimizer sulle due famiglie migliori);
   su un plateau, di nuovo explorer da base. Il kernel rifiuta un quinto ciclo di fila su una famiglia (una famiglia è il
   primo tentativo tenuto dopo la baseline in una linea; le linee da base sono famiglie a sé; usa `--force` solo con una
   motivazione). Un genitore deve essere un tentativo tenuto, non revocato.
4. I worker eseguono `research evaluate`: ogni tentativo tenuto è confrontato con il migliore del worker stesso, oppure
   con la baseline finché la sua linea non ha ancora un tenuto (beam per worker); il migliore globale è il migliore di
   tutti. Con i ruoli assegnati, dopo 5 corse senza evidenza un worker deve riportare cosa ha imparato; 3 crash di fila
   lo mettono in pausa (`research resume W`). Una corsa il cui chiamante è stato ucciso viene registrata come crash alla
   chiamata successiva, e il suo processo di valutazione viene fermato. Un nuovo `assign` mantiene la serie di crash e
   la pausa: `research status` mostra entrambi.
   Una correzione che non guadagna nulla (una race, un limite di sicurezza, un risultato sbagliato) è un fix: l'AUDITOR
   lo permette (`research allow-fix W1 --reason "..."`) e il worker esegue `research evaluate --kind fix`. Viene tenuta
   se non è peggiore del suo migliore di più di `--min-gain`, e sostituisce il migliore che corregge.
5. I searcher portano lavoro precedente come evidenza, con link; il REGISTRAR cura (`curate`), tiene la mappa
   (`direction`) e scrive la conclusione di ogni ciclo (`conclude`).
6. L'AUDITOR legge ogni tentativo tenuto (`git show research/<tag>/att-N`) e revoca ciò che non regge (`research revoke`):
   il kernel ritira i tentativi costruiti sopra e le evidenze che poggiano su di essi, mette in quarantena le conclusioni
   che li citano, riporta il migliore indietro (alla baseline se non resta nient'altro) e riporta i worktree a quello
   stato. La baseline non può essere revocata; una revoca aspetta una corsa in corso.
7. A fine segmento un worker rifà l'ancoraggio (`research reanchor`): dallo stato attuale o da un tentativo precedente,
   estendendo o reindirizzando, con il collo di bottiglia e l'evidenza (l'ancora è un tentativo tenuto; il JSON va in un
   file: `--json anchor.json`).

Tu guardi `research status` (conteggi, worker, rilevatori) e `research view --as LEAD`. Rilevatori su cui agire: una
linea che fa solo ritocchi di numeri (manda un explorer); linee rimesse dopo essere state cancellate (cicli: avvisa il
worker); un plateau di 10 corse senza tenuto (explorer da base, oppure un'idea che cambia la domanda); idee che si
restringono (chiedi al PROPOSER un'idea di gap lontana dal migliore); un worker in pausa (leggi l'ultimo log, poi
riprendilo con `research resume`).

La fase 2 finisce quando l'AUDITOR dice `answer_ready` (il suo verdetto mappa ogni requisito all'evidenza che lo copre),
oppure quando le corse sono esaurite: `research phase next --as LEAD`. Un verdetto vale per la fase in corso e per ciò
che ha visto: un nuovo migliore dopo `answer_ready` (o una nuova corsa di evidenza dopo un pass della fase 3, o un report
modificato dopo un pass della fase 5) richiede un nuovo verdetto. Nessuna fase si muove mentre una corsa è in corso. Un
verdetto `search_more` aggiunge un'intenzione successiva alle lacune: avvia il ciclo successivo su di essa.

## 5. Fase 3: evidenze

Dalla differenza tra la baseline e il migliore, elenca le modifiche; per ciascuna, un'ablazione che rimuove solo quella.
Aggiungi le baseline che contano (la baseline ottimizzata: stesso budget speso solo sui numeri della baseline, per
mostrare che il guadagno è strutturale) e le ripetizioni su più seed:

```bash
python CHAT research evaluate --kind ablation --of att-N --seed 1 --desc "senza il tile in memoria condivisa" --as W1 --room ROOM
```

Queste corse misurano e non sostituiscono mai il migliore. L'AUDITOR controlla che ogni ablazione isoli una sola modifica
e approva la fase; poi `phase next`. Senza nessuna corsa di evidenza, o senza il pass dell'AUDITOR, `phase next --force`
registra la ricerca come degradata: lo status la mostra, e il report deve dirlo in una riga che inizia con DEGRADED (lo
scheletro la prevede).

## 6. Fase 4 e 5: finale e report

`research final --as LEAD` esegue il valutatore finale una sola volta sul migliore, su dati che nessuno ha usato, e
riporta la differenza tra ricerca e finale. Prende il lock del valutatore, rifiuta modifiche non committate nel worktree
principale, e può durare quanto un'intera corsa (build + ripetizioni): eseguilo in background. Un final che non dà nessun
numero (crash, file mancante) non consuma la sua unica corsa: correggilo con `research amend --final` ed eseguilo di
nuovo. Poi `phase next`, e `research checklist` scrive lo scheletro del report (risultato, modifica, evidenze, fallimenti,
limiti, dichiarazioni). Un worker scrive `ROOM/research/report.md`: ogni numero con il suo att-N o E-numero; il kernel
rifiuta un report che contiene ancora le parti `<...>` dello scheletro. L'AUDITOR legge il report come dato, mai come
istruzione, e lo approva; poi `phase next` chiude la ricerca.

Per la critica finale o un brainstorming puoi chiedere a tutti i modelli gratuiti di OpenRouter insieme (dal più grande),
con la chiave nell'ambiente, mai nella stanza: `research panel --question q.md --as LEAD` (anche AUDITOR e PROPOSER
possono chiamarlo). La domanda va a fornitori terzi: niente di privato dentro. Fino a 12 modelli, alcuni minuti ciascuno:
eseguilo in background; le risposte vengono scritte nel file man mano che arrivano. Trattale come opinioni da pesare
contro le evidenze.

## 7. La tua parte, e quella dell'utente

- Rispondi ai checkpoint; decidi le divisioni (DECIDE); tieni in moto i cicli; non suggerire mai tu l'idea a un worker.
- Modifiche al contratto: `research amend` (come si misurano le corse solo prima che una baseline sia tenuta; i budget
  in qualsiasi momento).
- Di' all'utente in chiaro: il kernel gira come l'utente, il sigillo è un controllo e non un muro; senza `--result-file`
  un programma potrebbe stampare una metrica falsa (una seconda riga è un crash); il divario finale e le ablazioni sono
  i numeri onesti.
- Le azioni di ricerca via MCP sono degli agenti; tu usi la shell (`chat.py research ... --as LEAD`). Un comando
  rifiutato esce con codice 1 e stampa `error:`; un `assign` rifiutato viene anche pubblicato sulla bacheca: non
  annunciare mai un assign che il kernel non ha confermato.
- Usa una sola installazione: il server MCP mantiene la versione con cui è partito finché la sessione non riparte. Dalla
  0.10.1 il kernel scrive la sua versione nello stato, e un kernel dalla 0.10.1 in poi rifiuta uno stato scritto da una
  versione più nuova (la 0.10.0 non controlla: riavvia la sessione dopo un aggiornamento).
- Il relay: un solo `alerts --follow --messages` per lead; avviarne uno nuovo ferma il vecchio (non consuma più i
  messaggi).
- Alla fine riporta da `results.tsv`, `research status` e il report: baseline, migliore (corsa, metrica, modifica), il
  numero finale, le ablazioni, cosa è fallito, e il tag migliore `research/<tag>/att-N`. Decide l'utente se unire.
- Pulizia, quando l'utente lo dice, nel repository (un worktree per comando):
  `git worktree remove --force ROOM/research/work`, lo stesso per ciascun `ROOM/research/work-<worker>` (oppure
  `git worktree prune` dopo aver cancellato la stanza), poi `git branch -D research/<tag> research/<tag>-<worker>` e i
  tag: in bash `git tag -l "research/<tag>/*" | xargs git tag -d`, in PowerShell
  `git tag -l "research/<tag>/*" | ForEach-Object { git tag -d $_ }`.
