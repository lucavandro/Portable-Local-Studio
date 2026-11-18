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

- `name`: nome mostrato agli studenti.
- `filename`: nome del file locale, con estensione `.gguf`.
- `approxSize`: dimensione indicativa mostrata nell'app, ad esempio `491 MB`.
- `url`: collegamento pubblico diretto al file da scaricare, non alla pagina del modello.
- `notes`: breve descrizione in italiano, con indicazioni per l'attività didattica.

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
La dimensione indicata è informativa: i limiti reali restano nel programma, fino a 2 GiB per i modelli chat e 200 MB per Whisper. Aggiungere un modello al catalogo non garantisce che il motore ne supporti l'architettura o che funzioni bene sui portatili: provalo prima sul PC del laboratorio.
