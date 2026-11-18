# Local Studio Scuola

Versione didattica di Portable AI Studio per laboratori con Intel i3/i5, 8 GB di RAM e senza scheda grafica dedicata.

Le elaborazioni AI avvengono sul computer: nessuna API a pagamento, chiave API o abbonamento. Internet è necessario per installare i componenti e scaricare i modelli; dopo la preparazione le attività funzionano offline. Il progetto non addestra grandi modelli: utilizza modelli già addestrati.

## Attività mantenute

| Funzione                                   | Uso in laboratorio                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| Chat locale                                | Prompt, confronto delle risposte, temperatura, limiti e errori dei modelli |
| Documenti di testo, codice e PDF con testo | Analisi di brevi estratti, spiegazioni e classificazione                   |
| Trascrizione con Whisper Tiny/Base         | Registrazioni brevi, riconoscimento multilingue incluso l’italiano         |
| Sintesi vocale con Kokoro Q8               | Lettura del testo con le voci italiane Sara e Nicola incluse               |
| Cronologia locale ed esportazioni          | Conservare conversazioni, trascrizioni e file audio                        |
| CPU e RAM                                  | Osservare le risorse e i tempi delle attività                              |

La generazione e modifica delle immagini, la relativa galleria, i motori Stable Diffusion/OpenVINO/CoreML e i download CUDA/Vulkan/ROCm/SYCL sono stati rimossi. La ricerca web integrata è stata rimossa per mantenere il lavoro riproducibile anche offline. Sono disponibili l’interpretazione di immagini PNG/JPEG/WebP con un modello visivo e il suo proiettore compatibile, oltre a temi, dimensione del testo e controlli diagnostici essenziali.

Le vecchie cartelle di modelli e immagini eventualmente presenti non vengono cancellate automaticamente. Non sono più utilizzate dall’app scolastica.

## Preparare un computer

Su Windows 10/11 a 64 bit avvia `windows.bat`. Su Linux avvia `./linux.sh`, su macOS `./mac.sh`. Il setup installa nella cartella del progetto Node.js, llama.cpp CPU, Whisper e Kokoro, poi compila l’interfaccia. Su Windows il runtime Visual C++ può richiedere privilegi amministrativi. Il setup deve essere eseguito con Internet prima della lezione. Il launcher Windows e gli script di preparazione mostrano istruzioni in italiano: spiegano i sei passaggi, il ruolo dei motori AI e come iniziare. I messaggi tecnici prodotti da npm, dai compilatori e dai motori possono restare in inglese. Lascia aperta la finestra durante l'uso; premi Ctrl+C per terminare.

1. Apri **Modelli → Chat** e inizia con **MiniCPM5 1B**, versione **Q4_K_M**, oppure importa il GGUF già scaricato. Ogni modello ha un menu di quantizzazioni con dimensioni effettive.
2. Confronta versioni dello stesso modello o MiniCPM5 2B. Il catalogo include K2-Horizon, Gemma 4 E2B/E4B e varianti Heretic. I badge descrivono multimodalità, ragionamento e rifiuti ridotti: non sono garanzie di qualità. Per Gemma visivo scarica anche il proiettore dalla relativa scheda, poi carica o ricarica il modello nella chat e allega una piccola immagine. I proiettori sono esclusi dal selettore dei modelli chat.
3. In **Modelli → Trascrizione** scarica **Whisper Tiny multilingue**. Base e Base Q5 sono alternative per il confronto.
4. In **Modelli → Voce** prepara **Kokoro Q8** e scegli **Sara** (predefinita) o **Nicola**, entrambe italiane. Esegui una breve lettura con ogni voce che userai: pesi e voci vengono scaricati al primo utilizzo e conservati nella cache locale.
5. Disconnetti Internet e prova chat, trascrizione e voce prima di distribuire la cartella sugli altri PC con lo stesso sistema operativo.

L’interfaccia si apre su `http://localhost:1420`; l’avvio sceglie un’altra porta se occupata. Ogni PC conserva i propri dati. Non è un server multiutente per la classe e non richiede un account degli studenti.

Se una vecchia preparazione mostra «Get-IntelOpenVinoNpu non riconosciuto» dopo Kokoro, aggiorna la cartella del progetto e riavvia `windows.bat`. Era un controllo hardware rimasto dalla versione con OpenVINO, ora rimosso: non occorre installare OpenVINO, driver NPU o cancellare i modelli già scaricati. Il messaggio non indica un errore delle voci italiane.

## Modificare i modelli consigliati

I cataloghi sono nella cartella [`config/models/`](config/models/README.md): [`chat.json`](config/models/chat.json), [`trascrizione.json`](config/models/trascrizione.json) e [`voce.json`](config/models/voce.json). La guida nella cartella spiega i campi. Dopo una modifica riavvia l’app e ricarica la pagina; non serve ricompilare l’interfaccia.

## Profilo per 8 GB di RAM

- Solo esecuzione su CPU, fino a 4 thread, contesto fino a 2.048 token e risposte fino a 512 token (384 iniziali).
- File GGUF e proiettori fino a 4 GiB ciascuno (4.294.967.296 byte). La dimensione del file non corrisponde alla RAM totale necessaria: proiettore, contesto e sistema operativo richiedono altra memoria. Le varianti grandi sono sperimentali sui portatili da 8 GB.
- Un’unica coda per caricamenti e attività AI: chat e audio non vengono elaborati contemporaneamente. Prima di trascrivere o sintetizzare viene liberato il modello chat. Per tornare alla chat seleziona nuovamente il modello.
- Il ragionamento esteso si può attivare nei modelli indicati dal catalogo, ma resta nel limite di risposta e può consumarlo prima della risposta finale. Modelli visivi e proiettori vengono eseguiti su CPU; nessuna memoria bloccata in RAM.
- Documenti fino a 5 MB; il contesto è breve, quindi scegli estratti contenuti. I PDF scansionati richiedono prima un’estrazione OCR esterna.
- Su Linux i binari precompilati richiedono le librerie verificate dal setup; Linux/macOS non sono stati provati su hardware reale per questa revisione.

Per il corso si possono confrontare regole programmate e classificazioni del modello su esempi con risposte note. Questa versione non include Jev o un altro System One model specializzato. Una percentuale scritta da un modello chat non va trattata come probabilità calibrata.

I modelli piccoli possono sbagliare anche compiti semplici. La qualità in italiano e la velocità vanno provate sui portatili del laboratorio; non sono promesse prestazioni equivalenti a un servizio cloud.

La web UI è in italiano: chat, trascrizione, voce, modelli, impostazioni, temi, conferme e descrizioni accessibili dei controlli. I nomi dei modelli, i formati dei file e i contenuti delle conversazioni mantengono il testo originale. Dopo un aggiornamento del codice, ricompila l’interfaccia con `npm run build` in `app/frontend`, riavvia l’app e ricarica la pagina per vedere i nuovi testi.

Il motore è fissato a llama.cpp **b11460**, che include le architetture `k2-horizon`, `gemma4` e `minicpm`. I launcher aggiornano le installazioni precedenti quando Internet è disponibile. K2-Horizon richiede almeno b11454: il server blocca un motore precedente con un messaggio esplicativo. Compatibilità dell’architettura non significa che siano già state misurate qualità e prestazioni di ogni modello sul laboratorio.

## Sviluppo e controlli

```powershell
cd app/frontend
npm ci
npm test
npm run build
```

Il frontend è React/Vite, il server è `scripts/server/serve.cjs`, la build è in `app/dist/`. Non viene avviato alcun modello all’apertura dell’app. I modelli stanno in `app/llm-models/`, `app/speech-models/`, `app/tts-models/`; conversazioni e audio restano nelle rispettive cartelle sotto `app/`.

I test coprono streaming della chat, persistenza, riconoscimento dei formati, API rimosse, cataloghi scolastici, limiti CPU e condivisione della coda. Non misurano l’inferenza di modelli reali sui PC del laboratorio.

## Licenza

Il codice mantiene la licenza MIT e l’attribuzione del progetto originale in [LICENSE](LICENSE). Modelli e runtime hanno licenze proprie; il catalogo usa download pubblici gratuiti.

Per aggiornare una vecchia installazione vocale, avvia nuovamente il launcher: rileva e installa il fonemizzatore italiano mancante. Il runtime include eSpeak NG multilingue (`@echogarden/espeak-ng-emscripten`, GPL-3.0), senza installazioni globali. Le vecchie registrazioni restano riproducibili; le preferenze di una voce inglese passano a Sara.

Verifica v0.2.1 (18 novembre 2026): 32 test superati, build e controlli statici riusciti. Sono stati generati due audio reali con Kokoro Q8 su CPU (Sara: 5,575 s; Nicola: 6 s), con un testo italiano di prova; Nicola è stato verificato con download remoti disabilitati e soli pesi in cache. La velocità sui portatili del laboratorio resta da misurare.
