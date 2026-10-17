# Integrazioni della modalità `research`

Idee valutate e non ancora fatte. Fonti da maggio 2026 in poi, aperte sulla loro pagina; le più vecchie solo dove nulla di recente le ha superate (segnate "prima di maggio"). Nulla si implementa senza ok.

Progetto completo: [research-mode.md](research-mode.md). Le integrazioni dell'harness generale sono in [integrazioni-harness.md](integrazioni-harness.md).

## Da fare

Stato 17/10/2026: A1-A8 progettati dopo la lettura completa dei paper (A1-A2: [research-mode.md](research-mode.md) §1-2.7; A3-A8: §2.8). Ordine di costruzione proposto: A8 (ciclo minimo) → A2 kernel → A1 fasi → A5, A4, A3, A6, A7.
A1-A7, squadra web e pannello OpenRouter costruiti il 18/10 (0.10.0, kernel scripts/research.py, template per ruolo, guida research). A8 costruito il 17/10: `scripts/research.py` + `chat.py research init|evaluate|status` (anche MCP), template `research_worker.md`, skill init sezione 4b; smoke test 21/21. Ogni attempt ha un tag git (base per A5).


| # | Integrazione | Fonte | Costo |
|---|---|---|---|
| A1 | **Fasi con cancelli** della Sakana: drafting, investigation, ablations, final, posthoc, report; contratto sigillato con hash, `evaluate` lanciato da chat.py e non dall'agente, best aggiornato solo se corretto e strettamente migliore, l'utente approva ai cancelli | *The Agentic Scientist* (AI Scientist v3), [2610.18933](https://arxiv.org/abs/2610.18933), 13/10/2026 | alto |
| A2 | **Propose → Commit → Audit al posto della memoria condivisa libera**, con i ruoli Sakana fissi: PROPOSER (ideazione in sola lettura), WORKER ×2 (esecuzione, ognuno sul suo ramo), kernel di chat.py + REGISTRAR (unici a scrivere lo stato della ricerca, con provenienza e budget), AUDITOR (chiusure e cancelli: completezza, fondatezza, coerenza, protocollo); i worker leggono solo una vista limitata dello stato curato; restrizioni sulle mosse dopo un rifiuto | *Harness-Search*, [2610.05382](https://arxiv.org/abs/2610.05382), 04/10/2026: senza Memory Operator −13 punti di recall, senza Auditor −5,7, i tre ruoli in un prompt solo −2,5; *PatchBoard*, [2605.29313](https://arxiv.org/abs/2605.29313), 28/05/2026: kernel deterministico, 84,6% contro 61,6% e 30,8%, 45,5k token contro 64,2k e 368,3k; *MemTX*, [2607.23929](https://arxiv.org/abs/2607.23929), 27/07/2026: ogni record con evidenza e provenienza, ritiro a cascata | alto, è il cuore di A1 |
| A3 | **Ideazione contro il restringimento**: due modi fissi del PROPOSER, *gap* (cosa manca) e *analogia* (soluzioni prese da problemi simili di altri campi); il kernel rifiuta idee troppo simili a quelle già in storia | *AI Research Agents Narrow Scientific Exploration*, [2605.27905](https://arxiv.org/abs/2605.27905), 27/05/2026 (219.655 idee: più concentrate e vicine alla letteratura di partenza degli umani); *IdeaScientist*, [2610.04074](https://arxiv.org/abs/2610.04074), 02/10/2026 (+14% sul miglior autoresearch open source, soprattutto novità) | medio |
| A4 | **Un ramo git per idea**, che resta vivo anche se perde; il lead sceglie da quale ramo ripartire ed explorer (contesto pulito) o optimizer (continua la storia del genitore), senza suggerire idee | *SwarmResearch*, [2607.02807](https://arxiv.org/abs/2607.02807), 02/07/2026 (skill di Claude Code; batte EvoX su 13/15) | medio |
| A5 | **Stati recuperabili**: un tag git per attempt e un comando per ripartire da uno stato vecchio invece di insistere su un vicolo cieco | *ScienceFlow*, [2608.14354](https://arxiv.org/abs/2608.14354), 14/08/2026 (70,22% su MLE-bench in 24 h) | basso |
| A6 | **Detector della ricerca**: file sigillato cambiato; metodo di valutazione diverso dal contratto (es. majority voting al posto di pass@1, il guasto che la Sakana ha visto solo a mano); best senza `correct`; righe che rimettono ciò che un attempt aveva tolto (~30% delle righe aggiunte dagli agenti evolutivi); punteggio salito solo sul search evaluator | Sakana [2610.18933](https://arxiv.org/abs/2610.18933); *What Do Evolutionary Coding Agents Evolve?*, [2605.20086](https://arxiv.org/abs/2605.20086), 19/05/2026 | medio |
| A7 | **Rubric dell'Auditor per fase** (Proposta, Esperimento, Sintesi) e checklist di verificabilità: seed, tracce di esecuzione, controllo di novità, come sono stati scelti i risultati mostrati | *ARAC-Bench*, [2608.12788](https://arxiv.org/abs/2608.12788), 13/08/2026 (migliore 67,9/100, ρ 0,81 con dottorandi); survey *Autonomous Research Agents and the Verification Gap*, [2608.05179](https://arxiv.org/abs/2608.05179), 29/06/2026 (solo il 38% dei sistemi pubblica seed o tracce) | basso |
| A8 | Primo passo minimo prima di A1: ciclo alla autoresearch (`program.md` dell'utente, un file modificato, evaluator fisso, commit se migliora e reset se no, budget di tempo fisso) | Karpathy, autoresearch (prima di maggio) | basso |

## Più avanti

| # | Integrazione | Fonte |
|---|---|---|
| C1 | Bacheca tra laboratori: problemi con verificatore, classifica pubblica, forum per problema, ospitata nella sala comune condivisa con gli amici | *EinsteinArena*, [2606.10402](https://arxiv.org/abs/2606.10402), 09/06/2026 (12 nuovi SOTA, kissing number in dim. 11 da 593 a 604) |
| C4 | Valutare la coppia utente-agente, non l'agente da solo; rischio di omologazione delle ricerche | [2608.14667](https://arxiv.org/abs/2608.14667), 02/08/2026 |
| C5 | Torneo Elo tra ipotesi quando le idee sono troppe | Google Co-Scientist, [2502.18864](https://arxiv.org/abs/2502.18864) (prima di maggio; *Nature* 2026) |

## Scartate

- **Revisore di un'altra famiglia di modelli** (ARIS, [2605.03042](https://arxiv.org/abs/2605.03042)): scartata dall'utente.
- **Memoria condivisa libera tra pari come base della ricerca** (CORAL, [2604.01658](https://arxiv.org/abs/2604.01658), prima di maggio): sostituita da A2.
