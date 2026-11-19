import { useState } from "react";

const TERMS = [
  ["Instruct / instruction tuned", "Modello adattato a seguire istruzioni e conversare. Una versione base è invece addestrata soprattutto a continuare testi; non si comporta necessariamente come un assistente."],
  ["Heretic", "Nome di uno strumento e di varianti che modificano un modello per ridurne i rifiuti. Non è una famiglia di architetture e non garantisce risposte più vere o migliori."],
  ["Abliterated / abliterato", "Modello modificato tramite ablazione di direzioni interne associate ai rifiuti. Può cambiare anche altre capacità; non significa che siano stati rimossi tutti i limiti."],
  ["Uncensored / rifiuti ridotti", "Etichetta dell’autore per una variante che tende a rifiutare meno richieste. È una descrizione del comportamento, non una misura di accuratezza."],
  ["Quantizzazione", "Rappresentare i pesi con meno bit per ridurre file e memoria. È come arrotondare numeri: si risparmia spazio, ma parte dell’informazione può andare persa. Confronta lo stesso prompt fra versioni dello stesso modello."],
  ["Q4_K_M, Q3_K_S, Q5_K_M, Q8_0", "Q4 indica una quantizzazione nominalmente a 4 bit: non ogni tensore usa esattamente 4 bit. K identifica la famiglia di quantizzazioni a blocchi; S e M distinguono ricette piccola e media. Q8_0 usa una ricetta diversa a circa 8 bit. Un numero maggiore spesso conserva più informazione e richiede più spazio: velocità e qualità vanno misurate."],
  ["IQ, UD, F16, BF16", "IQ identifica ricette di quantizzazione basate sull’importanza dei pesi; UD indica varianti dinamiche pubblicate da Unsloth. F16 e BF16 sono formati in virgola mobile a 16 bit, diversi fra loro. Non esiste una classifica universale fra ricette: confronta dimensioni effettive e risultati."],
  ["Parametri: 1B, 2B, E2B", "B significa miliardi di parametri. I parametri sono numeri appresi durante l’addestramento. Sigle come E2B indicano parametri effettivi secondo la famiglia: non equivalgono a 2 GB di file o RAM."],
  ["Multimodale e proiettore", "Un modello multimodale può elaborare anche immagini. Nell’app serve un proiettore compatibile che trasformi le informazioni visive in una rappresentazione per il modello. Occupa memoria aggiuntiva; interpretare immagini non significa generarle."],
  ["Ragionamento / reasoning", "Modalità che produce passaggi intermedi prima della risposta. Può richiedere più tempo e consumare il limite di token. Non rende la risposta automaticamente corretta né descrive necessariamente come il modello è arrivato alla conclusione."],
  ["Token, contesto e cache KV", "I token sono frammenti di testo elaborati dal modello. Il contesto è la quantità di informazioni che può considerare insieme. La cache KV conserva calcoli delle parti precedenti e usa RAM: contesti più lunghi possono richiedere più memoria."],
  ["GGUF, RAM, GiB e token/s", "GGUF è il formato dei file usati da llama.cpp. La RAM è la memoria di lavoro: non coincide con lo spazio occupato dal file. Un GiB vale 1.073.741.824 byte. I token/s misurano la velocità di generazione; il tempo di lettura del prompt è una misura distinta."],
];
export default function ModelGlossary() {
  const [query, setQuery] = useState("");
  const terms = TERMS.filter(([term, text]) => `${term} ${text}`.toLocaleLowerCase("it").includes(query.trim().toLocaleLowerCase("it")));
  return <details className="model-glossary"><summary>ⓘ Capire i termini · glossario per il laboratorio</summary>
    <label>Cerca un termine<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Es. Heretic, instruct, Q4_K_M" /></label>
    <dl>{terms.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}</dl>
    {!terms.length && <p>Nessun termine trovato. Prova una parola più breve.</p>}
  </details>;
}
