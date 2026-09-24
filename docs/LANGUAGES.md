# Languages: who needs them, where the money is, and what CareCircle does

Researched 2026-09-23/24. Every figure has its source at the end.

## Where the money is

**US family caregiving.**
- 63 million Americans are family caregivers, 45% more than ten years ago.
- Their unpaid care is worth **$1.01 trillion a year**, and 57% of them give high-intensity
  care (AARP 2025 and 2026).
- Alexa+ is included with Prime in the US, so these families are the customers Amazon has
  already paid to reach.

**The parent and the children often speak different languages.**

| Americans aged 65+ (ACS 2024, B16004) | People | Speak English less than "very well" |
| --- | ---: | ---: |
| All | 61.2M | |
| Speak a language other than English at home | **9.9M** | **5.6M** |
| Spanish | 4.9M | **2.9M** (1.9M "not well" or "not at all") |
| Asian and Pacific Island languages | 2.2M | 1.5M |
| Other Indo-European languages | 2.3M | 1.0M |

The typical case is a mother who speaks Spanish and grown children who speak English, with one
Echo in bilingual mode. Classic Alexa has had US Spanish and a Spanish/English multilingual mode
since 2019. A care record has to follow **each person's** language, not the device's.

**Alexa+ is launching in other languages now:**
- Mexico (Spanish), Canada (French and English), Brazil (Portuguese, included with Prime);
- the UK, Spain, Italy, Germany and Austria, France, Australia;
- India (English, Hindi, Hinglish);
- more than 10 more countries in 2027.

**Money already crosses borders to pay for a parent's care.**
- US to Mexico: $61.8B in 2025, the largest remittance corridor in the world. More than 95%
  of it is sent from the US.
- To Nigeria: about $19.5B in 2023.
- The paying customer is the grown child with Prime. From the US to Mexico, **both ends are
  Alexa+ markets**. From the US or UK to Lagos, one end has no Alexa+ (none is announced for
  Africa), so the parent uses Telegram.

### All US languages spoken at home (ACS 2024, B16001, people aged 5+)

| | People | Speak English less than "very well" |
| --- | ---: | ---: |
| Speak a language other than English at home | **74.1M (23.0%)** | |
| Spanish | 44.9M | 18.4M |
| Chinese | 3.7M | 1.9M |
| Tagalog | 1.9M | |
| Vietnamese | 1.6M | |
| Arabic | 1.5M | |
| French (incl. Cajun) | 1.3M | 0.28M |
| Haitian | 1.0M | 0.45M |
| **Yoruba, Twi, Igbo or other West African languages** | **773K** | 149K |

The West African group is largest in Texas (122K), New York (103K), Maryland (75K),
California (49K) and Georgia (36K). The Census reports Yoruba, Igbo, Hausa and Edo only as part
of that group.

**African American English** is not counted by the Census, because it is English. The known gap
is in speech recognition: across Amazon, Apple, Google, IBM and Microsoft, the word error rate
was 0.35 for Black speakers and 0.19 for white speakers (Koenecke et al., PNAS 2020).
CareCircle's job is to **understand** it, and the dialect evals below measure that. It is not a
language to reply in: writing back in someone's dialect reads as mimicry.

## What AWS can do in each language

| Language | Transcribe (hear a voice note) | Polly (speak) | Translate |
| --- | --- | --- | --- |
| English | en-US, en-GB, en-IN, en-ZA … (no Nigerian English) | yes | yes |
| Spanish | es-US, es-MX, es-ES | es-US, es-MX, es-ES | yes |
| French | fr-FR, fr-CA | fr-FR, fr-CA | yes |
| Portuguese | pt-BR, pt-PT | pt-BR, pt-PT | yes |
| German, Italian | de-DE, it-IT | yes | yes |
| Hindi | hi-IN | hi-IN | yes |
| Chinese | zh-CN, zh-TW, Cantonese | Mandarin, Cantonese | yes |
| Haitian Creole | ht-HT | **no** | yes |
| Hausa | ha-NG **batch only** | **no** | yes |
| Yoruba, Igbo, Edo | **no** | **no** | **no** |

## What CareCircle does

Each person picks a language with **/language** in Telegram. What CareCircle promises depends
on the language:

| | Languages | Chat replies | Reminders and buttons | Voice note in | Voice note back |
| --- | --- | --- | --- | --- | --- |
| ready | English, Spanish, French, Portuguese, German, Italian, Hindi, Chinese | in the language | translated | in the language | Ruth, Lupe, Léa, Camila, Vicki, Bianca, Kajal, Zhiyu |
| draft | Nigerian Pidgin | in Pidgin | translated, **English underneath** | English recognition, shown back to correct | Ruth |
| draft | Yoruba, Igbo, Hausa | in the language, key facts also in English | translated, **English underneath** | speak English or Pidgin | none: answers stay written |
| understood | Edo | English (or Pidgin) | English | English or Pidgin | English |

Every language Alexa+ is sold in is "ready". Some rules hold in every language:

- **Facts never change with the language.** A medicine's name stays as the family wrote it,
  times and names stay exact, and "no record" is never translated as "missed".
- **A medicine can have the family's own name in each language.** "Mum calls her eye drops
  colírio" is saved with `change_medication` (or `add_medication`) as `alsoCalled`. Mum then
  sees "colírio" in her reminders, her tap answers and her shift brief. Her son still sees
  "eye drops", and "colírio" matches her drops the first time she says it, with or without
  the accent. The name comes from the family, never from a translation of ours. The record
  keeps its own name, and only the tools that read the record out loud use the other one.
- **A medicine said in another language is matched to the schedule, never saved as a stray.**
  When the name matches nothing on the person's schedule, `log_care_event` saves nothing yet.
  It answers with the names on that person's schedule, so the planner can call again with the
  right one. An unscheduled one-off, like a paracetamol, is saved once the person confirms it
  (`notOnSchedule`).
- **A draft translation is never the only copy.** Yoruba, Igbo, Hausa and Pidgin reminders
  carry the English underneath until a native speaker has checked them.
- **Nothing is promised that the services can't do.** When someone picks Yoruba, they are told
  that voice notes need to be in English or Pidgin, and that answers come as text.
- **Alexa's voice prompt is untouched.** The language rule is added only to the Telegram chat
  prompt, and only for a person who chose a language other than English.

The code and the phrasebook are in `src/domain/language.ts`.

## Measured

All runs use the production planner, `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. Raw
results are in `evals/results/`.

**A family in two languages (`npm run evals:languages`, part 2).**
- The setup: Mom says in her own language that she has just used her drops ("colírio",
  "gotas para los ojos", "आँखों की दवा"). Then her son asks in English whether she has.
- Graded: the dose must be on the record against the right medicine, Mom must be answered in
  her language, and her son must be told, in English, with the name, nothing invented and
  nothing "missed".

| | es | fr | pt | de | it | hi | zh | pcm | yo | ig | ha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Before the fix | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ |
| After | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

That is **1/11 before and 11/11 after**. Before the fix, the planner passed Mom's own word for
the medicine, it matched nothing, and it was saved as an unscheduled medicine. Her son was then
told there was no record of a dose she had taken. Only Pidgin passed, because Pidgin says
"eye drop".

**Replies in your own language keep the facts (part 1).**
- The setup: a coordinator asks, in their language, how Dad's day went. The morning dose is on
  the record and 8 PM has no record. English is the control.
- The first version of the rule let one Yoruba reply add "Dad's day went well", which no tool
  had said, and let one Hausa reply assume the reader's gender. The rule now forbids both.
  Since then, in every run and every language, replies have never said "missed", never invented
  anything, and have given both the logged dose and the 8 PM "no record".
- The one weakness: Spanish, Portuguese and Italian replies sometimes translate the medicine's
  name ("colírio", "collirio"), despite the rule. That makes 9 or 10 out of 12, depending on
  the run.

**Understanding (`npm run evals -- --dialects`).**
- 34 held-out cases. Each is a standard-English corpus request said another way: African
  American English, Pidgin, Nigerian English, Yoruba, Igbo, Hausa, Spanish, French and Chinese.
- Results: **34/34** now, after 30/34 and 32/34.
- The miss that repeated was Pidgin "I don use my eye drop". It was saved as a note, because
  "don" was read as "don't". `log_care_event` now says what Pidgin "don" means, and that case
  is marked `seen`.

**Nothing else moved.** The 155-case corpus with the new wording scored **147/155**, the same
as before. One case changed in each direction.

## Next, by what it's worth

1. **Medicine names per language.** Let the family give a medicine its name in each person's
   language ("eye drops" = "colírio"). That would end the name translation in Spanish,
   Portuguese and Italian replies, and would match "colírio" on the first call.
2. A native speaker checks the Yoruba, Igbo, Hausa and Pidgin phrasebooks. Checked ones
   become "ready".
3. An Edo speaker fills in the Edo phrasebook.
4. Haitian Creole: 1.0M speakers in the US, with Transcribe and Translate but no Polly voice.
5. Hausa voice notes through batch Transcribe (ha-NG).

## Sources

- US Census Bureau, American Community Survey 2024 1-year, tables B16001 and B16004, via
  [Census Reporter](https://censusreporter.org/tables/B16004/) (queried 2026-09-24).
- AARP, [Caregiving in the US 2025](https://www.aarp.org/caregiving/basics/caregiving-in-us-survey-2025/);
  AARP, [Economic value of family caregiving reaches $1 trillion](https://www.aarp.org/press/releases/2026-03-26-AARP-Economic-Value-Of-Family-Caregiving-Report.html) (March 2026).
- Amazon, ["Alexa, ¡Hola!"](https://www.aboutamazon.com/news/devices/alexa-hola) (US Spanish and multilingual mode);
  [Alexa+ international launch](https://www.aboutamazon.com/news/devices/alexa-plus-international-launch);
  [Alexa+ in Canada](https://www.aboutamazon.com/news/devices/alexa-plus-canada-launch).
- Banco de México via [Mexico News Daily](https://mexiconewsdaily.com/news/remittance-biggest-decline-in-16-years/) (2025 remittances);
  World Bank via [BusinessDay](https://businessday.ng/news/article/world-bank-predicts-bigger-diaspora-remittance-for-nigeria-in-2024/) (Nigeria 2023).
- Koenecke et al., [Racial disparities in automated speech recognition](https://www.pnas.org/doi/10.1073/pnas.1915768117), PNAS 2020.
- AWS docs: [Transcribe](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html),
  [Polly](https://docs.aws.amazon.com/polly/latest/dg/supported-languages.html),
  [Translate](https://docs.aws.amazon.com/translate/latest/dg/what-is-languages.html).
