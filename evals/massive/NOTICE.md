# MASSIVE (US English, test partition)

`en-US.test.jsonl` is the US English **test** partition of the MASSIVE dataset, 2,974
utterances, each kept with its id, scenario, intent and text (slot annotations and worker ids
are dropped).

> MASSIVE: A 1M-Example Multilingual Natural Language Understanding Dataset with 51
> Typologically-Diverse Languages. FitzGerald et al., 2022. Copyright Amazon.com Inc. or its
> affiliates. Licensed under the Creative Commons Attribution 4.0 International License
> (CC BY 4.0). https://github.com/alexa/massive

We use it as outside data for `npm run evals:massive`: phrasings that Amazon collected and
labelled, which nobody on this project wrote or tuned against. The labelling rules, which say
what counts as right for CareCircle on each intent, are in `src/evals/massive.ts` and were
fixed before any model was run.
