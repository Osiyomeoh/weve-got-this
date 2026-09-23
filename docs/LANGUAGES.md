# Languages: who needs them, what AWS can do, what CareCircle does

Researched 2026-09-23. Every figure has its source at the end.

## Who speaks what

### United States (ACS 2024 1-year, table B16001, people aged 5 and over)

| | People | Speak English less than "very well" |
| --- | ---: | ---: |
| Everyone aged 5+ | 321.7M | |
| Speak a language other than English at home | **74.1M (23.0%)** | |
| Spanish | 44.9M | 18.4M |
| Chinese (incl. Mandarin, Cantonese) | 3.7M | 1.9M |
| Tagalog (incl. Filipino) | 1.9M | |
| Vietnamese | 1.6M | |
| Arabic | 1.5M | |
| French (incl. Cajun) | 1.3M | 0.28M |
| Haitian | 1.0M | 0.45M |
| **Yoruba, Twi, Igbo or other West African languages** | **773K** | 149K |
| Amharic, Somali or other Afro-Asiatic | 639K | |
| Swahili or other Central, East and Southern African | 404K | |

The West African group is largest in Texas (122K), New York (103K), Maryland (75K),
California (49K) and Georgia (36K). The Census reports Yoruba, Igbo, Hausa and Edo only
as part of that group, never separately.

**African American English** is not counted by the Census, because it is English. The
known gap is in speech recognition. Across Amazon, Apple, Google, IBM and Microsoft, the
word error rate was 0.35 for Black speakers and 0.19 for white speakers (Koenecke et al.,
PNAS 2020). So CareCircle's job is to **understand** it: the dialect evals below measure
that. It is not a language to "reply in". Writing back in someone's dialect reads as mimicry.

### Where Alexa+ is

| Market | Status | Languages |
| --- | --- | --- |
| United States | Fully available | English |
| Canada | Fully available from 11 June | **English and French** |
| Mexico | Early Access from 22 January 2026 | Spanish |
| UK | Early Access from 19 March 2026 | English |
| Italy, Spain | Early Access from 15 and 23 April 2026 | Italian, Spanish |
| Germany, Austria | Early Access from 7 May 2026 | German |
| France | Early Access from 26 May 2026 | French |
| Brazil | Early Access from 18 June | Portuguese |
| Australia | Early Access from 6 August | English |
| India | Early Access from 16 September | English, Hindi, Hinglish |
| Next | "more than 10 additional countries in 2027" | |

No African market is announced. Spanish and French are the two Alexa+ languages after
English that matter most to CareCircle: Mexico and Spain for Spanish, Canada and France for
French. The US Spanish-speaking population, at 44.9M, is larger than either market.

### Nigeria

The pilot family speaks English and Pidgin, and mixes in Yoruba, Igbo and Hausa, often in
one sentence. That is the ordinary way a Nigerian family talks, not an edge case.

## What AWS can do in each language

| Language | Transcribe (hear a voice note) | Polly (speak) | Translate |
| --- | --- | --- | --- |
| English | en-US, en-GB, en-ZA … streaming (no Nigerian English) | yes (Ruth) | yes |
| Spanish | es-US, es-MX, es-ES streaming | es-US, es-MX, es-ES | yes (+ es-MX) |
| French | fr-FR, fr-CA streaming | fr-FR, fr-CA, fr-BE | yes (+ fr-CA) |
| Chinese | zh-CN, zh-TW, Cantonese streaming | Mandarin, Cantonese | yes |
| Haitian Creole | ht-HT streaming | **no** | yes |
| Hausa | ha-NG **batch only** | **no** | yes |
| Yoruba | **no** | **no** | **no** |
| Igbo | **no** | **no** | **no** |
| Edo (Bini) | **no** | **no** | **no** |
| Swahili, Somali, Amharic, Zulu | streaming | **no** | Swahili, Somali, Amharic |

## What CareCircle does

Each person picks a language with **/language** in Telegram. Every language is labelled
with how far it can be trusted:

| | Language | Chat replies | Reminders and buttons | Voice note in | Voice note back |
| --- | --- | --- | --- | --- | --- |
| ready | English, Spanish, French, Chinese | in the language | translated | in the language | Ruth / Lupe / Léa / Zhiyu |
| draft | Nigerian Pidgin | in Pidgin | translated, **English underneath** | English recognition, shown back to correct | Ruth |
| draft | Yoruba, Igbo, Hausa | in the language, key facts also in English | translated, **English underneath** | speak English or Pidgin (no service hears them) | none: answers stay written |
| understood | Edo | English (or Pidgin) | English | English or Pidgin | English |

Some rules hold in every language:

- **Facts never change with the language.** A medicine's name stays as the family wrote it,
  and times and names stay exact. "No record" is never translated as "missed".
- **A draft translation is never the only copy.** Yoruba, Igbo, Hausa and Pidgin reminders
  carry the English underneath, until a native speaker has checked them.
- **Nothing is promised that the services can't do.** When someone picks Yoruba, they are
  told that voice notes need to be in English or Pidgin, and that answers come as text.
- **Edo is honest about itself.** No speech service, translation service or model writes it
  well enough to send about someone's medicine. The phrasebook slots are there for an Edo
  speaker to fill in.
- **Alexa is untouched.** Alexa sets its own language, and the voice prompt is a measured
  contract. The language rule is added only to the Telegram chat prompt, and only when a
  person has chosen a language other than English.

The code is in `src/domain/language.ts`, and the phrasebook is in the same file.

## Measured

Both evals ran on the production planner, `us.anthropic.claude-sonnet-4-5-20250929-v1:0`.
Raw results are in `evals/results/`.

**Understanding (`npm run evals -- --dialects`).** 34 held-out cases, each the same
request as a standard-English corpus case but said another way. The question is whether
the right tool gets chosen.

| | AAE | Pidgin | Nigerian English | Yoruba | Igbo | Hausa | Spanish | French | Chinese |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Run 2 | 7/7 | 6/7 | 3/3 | 3/3 | 2/2 | 1/2 | 4/4 | 3/3 | 3/3 |

That is 32/34 (94.1%). Run 1 was 30/34. In run 1, one case's answer key was too narrow, so
it was widened and marked `seen`, and it is now reported apart from the others. The other
two run 1 misses were all-Yoruba and all-Hausa sentences, where the planner asked instead
of acting.

**The miss that repeats:** Pidgin "I don use my eye drop this morning" is saved as a note,
not a dose, in both runs. This is the most important sentence for the pilot, so it is the
first thing to fix, with a fresh corpus run afterwards.

**Replies keep the facts (`npm run evals:languages`).** A coordinator asks, in their own
language, how Dad's day went. The record has a logged morning dose and no record for 8 PM.
A separate model call grades each reply. English is the control.

| | Written in it | Never "missed" | Nothing invented | Name kept |
| --- | --- | --- | --- | --- |
| en, fr, zh, pcm, yo, ig, ha | ✔ | ✔ | ✔ | ✔ |
| es | ✔ | ✔ | ✔ | ✖ ("gotas para los ojos") |

That is 7/8, in two runs in a row. The first version of the rule also produced "Dad's day
went well" in Yoruba, which no tool had said, and a gendered "you" in Hausa. The rule now
forbids both, and neither has come back. Spanish still translates the medicine's name.

## Next, by what it's worth

1. Pidgin dose logging (above).
2. A native speaker checks the Yoruba, Igbo, Hausa and Pidgin phrasebooks. Checked ones
   become `ready` and drop the English line.
3. An Edo speaker fills in the Edo phrasebook.
4. Haitian Creole: 1.0M in the US, with streaming Transcribe and Translate but no Polly
   voice. It would be `draft` with written answers, like Yoruba.
5. Hausa voice notes through batch Transcribe (ha-NG). That needs an S3 bucket, and an
   answer takes about 30 s longer.
6. The daily summary could name which dose was logged ("eye drops at 8:10 AM, from Dad")
   instead of "one medication logged today". That is a tool output change, so it needs a
   corpus run.

## Sources

- US Census Bureau, American Community Survey 2024 1-year, table B16001, "Language Spoken
  at Home by Ability to Speak English", via [Census Reporter](https://censusreporter.org/tables/B16001/)
  (queried 2026-09-23).
- US Census Bureau, [2017-2021 ACS language tables release](https://www.census.gov/newsroom/press-releases/2025/2017-2021-acs-language-use-tables.html)
  (over 500 languages tabulated; 22% speak a language other than English).
- Koenecke et al., [Racial disparities in automated speech recognition](https://www.pnas.org/doi/10.1073/pnas.1915768117),
  PNAS 117(14), 2020.
- Amazon, [Alexa+ arrives in India as Amazon's next-generation AI assistant expands internationally](https://www.aboutamazon.com/news/devices/alexa-plus-international-launch).
- Amazon, [Alexa+ now fully available across Canada](https://www.aboutamazon.com/news/devices/alexa-plus-canada-launch).
- AWS docs: [Transcribe supported languages](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html),
  [Polly languages](https://docs.aws.amazon.com/polly/latest/dg/supported-languages.html),
  [Translate languages](https://docs.aws.amazon.com/translate/latest/dg/what-is-languages.html).
