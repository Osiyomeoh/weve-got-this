# MASSIVE (US English, test, dev and a train sample)

`en-US.test.jsonl` is the US English **test** partition of the MASSIVE dataset, 2,974
utterances, and `en-US.dev.jsonl` its **dev** partition, 2,033 utterances, each kept with its id,
scenario, intent and text (slot annotations and worker ids are dropped). Both were checked
line for line against Amazon's release 1.1.

The test partition's failures were read before the tool descriptions were changed on
2026-09-24, so it no longer measures anything held out. The dev partition was added on
2026-10-02, after those changes, and no failure from it has been used to change CareCircle.

`en-US.train-focus.jsonl` is 1,599 utterances from the **train** partition (seed 20261003), drawn
on 2026-10-03 to tune against, so dev stays held out. Same fields.

> MASSIVE: A 1M-Example Multilingual Natural Language Understanding Dataset with 51
> Typologically-Diverse Languages. FitzGerald et al., 2022. Copyright Amazon.com Inc. or its
> affiliates. Licensed under the Creative Commons Attribution 4.0 International License
> (CC BY 4.0). https://github.com/alexa/massive

We use it as outside data for `npm run evals:massive`: phrasings that Amazon collected and
labelled, which nobody on this project wrote or tuned against. The labelling rules, which say
what counts as right for CareCircle on each intent, are in `src/evals/massive.ts` and were
fixed before any model was run.
