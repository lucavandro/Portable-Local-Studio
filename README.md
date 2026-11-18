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

La generazione e modifica delle immagini, la relativa galleria, i modelli visivi della chat, i motori Stable Diffusion/OpenVINO/CoreML e i download CUDA/Vulkan/ROCm/SYCL sono stati rimossi. La ricerca web integrata è stata rimossa per mantenere il lavoro riproducibile anche offline. Restano temi, dimensione del testo e controlli diagnostici essenziali.

Le vecchie cartelle di modelli e immagini eventualmente presenti non vengono cancellate automaticamente. Non sono più utilizzate dall’app scolastica.

## Preparare un computer

Su Windows 10/11 a 64 bit avvia `windows.bat`. Su Linux avvia `./linux.sh`, su macOS `./mac.sh`. Il setup installa nella cartella del progetto Node.js, llama.cpp CPU, Whisper e Kokoro, poi compila l’interfaccia. Su Windows il runtime Visual C++ può richiedere privilegi amministrativi. Il setup deve essere eseguito con Internet prima della lezione.

1. Apri **Modelli → Chat** e scarica **Qwen 2.5 0.5B Instruct Q4_K_M**, oppure importa il file GGUF già scaricato.
2. Per confrontare due modelli usa anche **Qwen 2.5 1.5B Instruct Q4_K_M**. Il secondo modello può risultare più lento; misuralo sul computer reale.
3. In **Modelli → Trascrizione** scarica **Whisper Tiny multilingue**. Base e Base Q5 sono alternative per il confronto.
4. In **Modelli → Voce** prepara **Kokoro Q8** e scegli **Sara** (predefinita) o **Nicola**, entrambe italiane. Esegui una breve lettura con ogni voce che userai: pesi e voci vengono scaricati al primo utilizzo e conservati nella cache locale.
5. Disconnetti Internet e prova chat, trascrizione e voce prima di distribuire la cartella sugli altri PC con lo stesso sistema operativo.

L’interfaccia si apre su `http://localhost:1420`; l’avvio sceglie un’altra porta se occupata. Ogni PC conserva i propri dati. Non è un server multiutente per la classe e non richiede un account degli studenti.

## Profilo per 8 GB di RAM

- Solo esecuzione su CPU, fino a 4 thread, contesto fino a 2.048 token e risposte fino a 512 token (384 iniziali).
- File GGUF chat fino a 2 GiB; il catalogo propone solo modelli piccoli. La dimensione del file non corrisponde alla RAM totale necessaria.
- Un’unica coda per caricamenti e attività AI: chat e audio non vengono elaborati contemporaneamente. Prima di trascrivere o sintetizzare viene liberato il modello chat. Per tornare alla chat seleziona nuovamente il modello.
- Nessun ragionamento esteso, modello visivo o memoria bloccata in RAM.
- Documenti fino a 5 MB; il contesto è breve, quindi scegli estratti contenuti. I PDF scansionati richiedono prima un’estrazione OCR esterna.
- Su Linux i binari precompilati richiedono le librerie verificate dal setup; Linux/macOS non sono stati provati su hardware reale per questa revisione.

Per il corso si possono confrontare regole programmate e classificazioni del modello su esempi con risposte note. Questa versione non include Jev o un altro System One model specializzato. Una percentuale scritta da un modello chat non va trattata come probabilità calibrata.

I modelli piccoli possono sbagliare anche compiti semplici. La qualità in italiano e la velocità vanno provate sui portatili del laboratorio; non sono promesse prestazioni equivalenti a un servizio cloud.

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
