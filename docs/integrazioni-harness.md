# Integrazioni dell'harness della chatroom

Idee valutate e non ancora fatte. Fonti da maggio 2026 in poi, aperte sulla loro pagina; le più vecchie solo dove nulla di recente le ha superate (segnate "prima di maggio"). Nulla si implementa senza ok.

Valgono per tutte le stanze. Quelle della modalità research sono in [integrazioni-research.md](integrazioni-research.md). Qui confluiranno anche i risultati dello sciame Haiku sull'harness.

## Da fare


| # | Integrazione | Fonte | Costo |
|---|---|---|---|
| B1 | **AUDITOR con veto su `CLOSED`**: la chiusura passa solo se l'auditor conferma che le prove bastano; se rifiuta, scrive cosa manca come task e la stanza riparte da lì | *Harness-Search*, [2610.05382](https://arxiv.org/abs/2610.05382) | basso |
| B2 | **Board governata**: `task fact` e `task decide` diventano proposte che il kernel valida (schema, chi può scrivere cosa, fonte obbligatoria: messaggio, file:riga, attempt) prima di entrare | *PatchBoard*, [2605.29313](https://arxiv.org/abs/2605.29313); *MemTX*, [2607.23929](https://arxiv.org/abs/2607.23929) | medio |
| B3 | **Quanti agenti**: la skill `start` ne propone pochi quando i compiti dipendono l'uno dall'altro e ne aggiunge (`add`) solo quando la board ha lavori indipendenti | *When More Is Less*, [2609.19759](https://arxiv.org/abs/2609.19759), 17/09/2026; Sakana: 2 worker al picco in metà tempo, oltre non garantito | basso |
| B4 | **Pannello di modelli gratuiti OpenRouter**: un comando che manda la stessa domanda a tutti i modelli `:free` in parallelo, salva le risposte e fa leggere a un aggregatore (il lead o un agente) le risposte intere: dove concordano, cosa dice solo una minoranza, cosa manca. Usi: brainstorming e idee del PROPOSER (contro il restringimento di A3), seconde opinioni, controllo di un'affermazione. Dettaglio sotto | sotto | medio |
| B5 | **Riunioni strutturate**: `meeting "agenda" --rounds N` (ognuno parla una volta per giro, il lead riassume e chiude), riunione individuale utente ↔ un agente senza svegliare gli altri, ruolo Critic fisso | Virtual Lab (Zou, *Nature* 2025, prima di maggio: nulla di più recente lo supera) | basso |
| B6 | **Vocabolario dell'harness** in 8 dimensioni per la doc, e la distinzione tra gusto generativo e valutativo | [2607.22682](https://arxiv.org/abs/2607.22682), 13/07/2026 | basso |

### B4 nel dettaglio: il pannello OpenRouter

- **Cosa c'è oggi** (API pubblica `GET https://openrouter.ai/api/v1/models`, letta il 17/10/2026): 467 modelli, 19 gratuiti. Testuali utili: `thinkingmachines/inkling:free` e `inkling-small:free` (1M di contesto), `nvidia/nemotron-3-ultra-550b-a55b:free`, `nemotron-3.5-super-vl:free`, `nemotron-3.5-lightning:free`, `nemotron-3-super-120b-a12b:free`, `nemotron-3-nano-omni-30b-a3b-reasoning:free`, `google/gemma-4-31b-it:free`, `gemma-4-26b-a4b-it:free`, `dots-studio/dots-3-note-preview:free`, `xingchen-agi/xing4.0-29b-a4b:free`, `poolside/laguna-s-2.1:free`, `laguna-xs-2.1:free`, `cohere/north-mini-code:free`, `liquid/lfm-2.5-2.6b:free`, più il router `openrouter/free`. Da escludere: i due Lyria (musica) e `nemotron-3.5-content-safety` (classificatore). La lista cambia: il comando la rilegge ogni volta.
- **Limiti** ([doc ufficiale](https://openrouter.ai/docs/api-reference/limits)): 20 richieste al minuto per i `:free`; 50 al giorno con meno di 10 crediti comprati in tutto, 1000 al giorno da 10 crediti in su; più chiavi o account non alzano i limiti; su 429 rispettare `Retry-After`. Un pannello da ~15 modelli sta nel limite al minuto, ma con 50 al giorno fa tre giri: servono i 10 crediti per usarlo davvero. `GET /api/v1/key` dice quante richieste restano oggi.
- **Cosa dicono i paper sul combinare tanti modelli**: il guadagno ha un tetto pari alla quota di domande su cui sbagliano **tutti** insieme, e viene da modelli che sbagliano su domande diverse, non dal loro numero (*Co-Failure Ceiling*, [2606.27288](https://arxiv.org/abs/2606.27288), 25/06/2026, 67 modelli); il voto a maggioranza butta via i passaggi giusti delle minoranze, un aggregatore che legge i ragionamenti interi li recupera anche quando tutti concordano sulla risposta sbagliata (*Beyond Consensus*, [2605.29116](https://arxiv.org/abs/2605.29116), 27/05/2026); conviene scegliere i modelli per complementarità, non solo per bravura (*Mixture of Complementary Agents*, [2605.24048](https://arxiv.org/abs/2605.24048), 05/2026); le metriche di diversità usate di solito possono non misurare la diversità vera (*Are Diversity Metrics Measuring Diversity?*, [2607.20768](https://arxiv.org/abs/2607.20768), 07/2026).
- **Quindi**: niente voto, sintesi delle risposte intere; il valore è sulle domande aperte (idee, critiche, cose che sfuggono) più che su quelle con una risposta sola; tenere un registro di quali modelli portano punti unici che poi si rivelano giusti, per scegliere il pannello per complementarità.
- **Forma**: `chat.py panel "domanda"` (o un comando rapido `/pannello` dal viewer): chiamate in parallelo con coda a 20 al minuto, risposte salvate in `ROOM/panel/<n>/` una per modello, una riga in chat con il riepilogo e il link; l'aggregatore è un agente della stanza. La chiave è dell'utente, in una variabile d'ambiente, mai nella stanza.

## Più avanti

| # | Integrazione | Fonte |
|---|---|---|
| C2 | Mini-benchmark di coordinamento per confrontare versioni dell'harness (la comunicazione è il fattore principale; saper fare il compito non è sapersi coordinare) | *alem*, [2606.08340](https://arxiv.org/abs/2606.08340), 06/06/2026 |
| C3 | Harness per giornate intere: sottocompiti limitati, memoria di esecuzione sotto pressione, verifica e riparazione del consegnato | *OneDayAgent*, [2608.05013](https://arxiv.org/abs/2608.05013), 04/08/2026 |

## Sciame Haiku (coordinamento, token, compiti, verifica, infrastruttura)

In arrivo.
