# Cataloghi dei modelli consigliati

Modifica questi file per cambiare i modelli proposti nella pagina **Modelli**:

| File | Attività |
| --- | --- |
| `chat.json` | Chat e analisi di documenti |
| `trascrizione.json` | Riconoscimento del parlato con Whisper |
| `voce.json` | Lettura dei testi con Kokoro |

Ogni file contiene un elenco JSON di modelli. L'ordine nell'elenco è quello mostrato nell'app.
I file vengono letti all'avvio: dopo una modifica **riavvia Local Studio e ricarica la pagina**.
Non occorre ricompilare l'interfaccia. I modelli già scaricati non vengono cancellati.

## Campi per la chat

Ogni oggetto rappresenta un modello, con più versioni in `variants`:

- `id`, `name`: identificativo stabile e nome visualizzato.
- `repository`: repository Hugging Face, ad esempio `openbmb/MiniCPM5-1B-GGUF`.
- `multimodal`, `reasoning`, `uncensored`: valori booleani mostrati come caratteristiche nella UI. `uncensored` descrive i rifiuti ridotti dichiarati dall'autore, non l'accuratezza.
- `notes`: descrizione didattica specifica del modello, in italiano.
- `preferredQuantization`: versione inizialmente selezionata nella scheda.
- `variants`: elenco di versioni, ciascuna con `quantization`, `filename`, `sizeBytes`, `approxSize` e `url` diretto al file.
- `projectorFile` (solo modelli visivi): percorso del proiettore nel repository. Il comando di aggiornamento genera `projector`, con URL, dimensioni e nome locale univoco per evitare collisioni fra i repository.
- `sourceRevision`, `verifiedAt`: revisione Hugging Face e data del controllo dei file.

### Aggiornare tutte le quantizzazioni

Dalla radice del progetto, con Internet attivo:

```powershell
node scripts/update-model-catalog.cjs
```

Su Windows puoi usare anche il Node portatile già installato:

```powershell
.\app\tools\node-win\node.exe scripts/update-model-catalog.cjs
```

Il comando consulta l'API pubblica di Hugging Face, aggiorna URL e dimensioni in byte e include tutte le versioni GGUF singole entro 4 GiB. Esclude file ausiliari MTP, imatrix e proiettori dalle quantizzazioni; per i proiettori usa solo il file esplicitamente configurato. Non inventa nuove quantizzazioni e non scarica i pesi. Scrive il catalogo solo se tutti i repository sono stati controllati con successo. Nomi, caratteristiche, note e preferenze restano quelli scelti dal docente. I download sono fissati alla revisione verificata, per riprodurre la lezione.

L'app usa il JSON salvato e non consulta Hugging Face all'avvio. Per aggiungere un modello basta una nuova scheda con repository, caratteristiche e note, poi eseguire il comando. Per importare a mano un proiettore di un modello del catalogo, usa il nome locale indicato in `projector.filename`. Un proiettore non si carica come modello indipendente. Non abbinare proiettori di modelli diversi.

## Campi per la trascrizione

- `id`: identificativo univoco, usato per selezionare il modello dal catalogo.
- `name`, `filename`, `url`: nome visualizzato, file `.bin` e collegamento diretto al download.
- `size`: dimensione indicativa mostrata nell'app.
- `language`: `Multilingual` per i modelli multilingue; `English` per quelli solo inglesi. Sono valori tecnici, non etichette da tradurre.
- `recommended`: `true` per il modello preferito, `false` per le alternative.
- `notes` (facoltativo): indicazioni in italiano.

## Campi per la voce

- `id`: identificativo univoco della configurazione vocale.
- `name`: nome mostrato nell'app.
- `filename`: nome del file locale `.json` che viene creato preparando il modello.
- `modelId`: identificativo del repository Hugging Face dei pesi Kokoro ONNX.
- `dtype`: quantizzazione dei pesi; il catalogo scolastico usa `q8`.
- `size`, `format`: informazioni mostrate nell'app.
- `recommended`: indica il modello preferito.
- `notes` (facoltativo): indicazioni in italiano.

Per Kokoro non serve un `url`: il programma prepara la configurazione e scarica i pesi al primo utilizzo. Questo catalogo usa il motore Kokoro già integrato; non consente di aggiungere motori vocali diversi. Le singole voci Sara e Nicola sono definite in `app/frontend/src/config/tts-voices.json`, a partire dalla radice del progetto.

## Prima di distribuire il catalogo alla classe

Usa JSON valido: chiavi e stringhe tra doppi apici, nessun commento e nessuna virgola dopo l'ultimo elemento. Mantieni univoci i nomi dei file e gli identificativi.
La dimensione indicata è informativa: i limiti reali restano nel programma, fino a 4 GiB per i modelli chat e 200 MB per Whisper. Aggiungere un modello al catalogo non garantisce che il motore ne supporti l'architettura o che funzioni bene sui portatili: provalo prima sul PC del laboratorio.
