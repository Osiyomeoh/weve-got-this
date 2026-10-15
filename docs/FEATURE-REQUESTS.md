# Feature requests

These are the things we kept wishing existed while we built CareCircle. Each one is
addressed to the team that owns that part, and rated by how much it hurt: critical,
important or nice-to-have. Each one is a place where we wanted to do right by a family
looking after someone, and had to settle for a workaround. Where we found one, we say what
it was, because the workaround usually shows what the platform should have done.

---

## MCP specification / TypeScript SDK

### Sessions that know which person is acting
- **Urgency:** important
- **What:** A documented pattern for a server whose data is shared by several people with
  different permissions, where the session credential says which person is acting.
- **Why it matters:** MCP mostly reads as one user talking to one server. CareCircle is one
  shared record with four people around it: the person being cared for, two family members
  with different permissions, and a paid helper. Every tool call has to be tied to a person
  and checked. We built that ourselves, but every multi-user MCP server will build it again,
  differently, and many will get the permissions slightly wrong.
- **Instead:** Each member has their own bearer credential, mapped to a member id and checked
  against a role permission table on every call.

### A way for a server to say today's date and time
- **Urgency:** critical
- **What:** Let a server send the current time and an IANA timezone to the client, next to
  `instructions` on initialize, or as a standard `_meta` key.
- **Why it matters:** This is the only request here that has already put wrong data in a
  medical record. Asked to record "cardiology Thursday at ten", a planner that didn't know
  the date saved **19 December 2024**, with no timezone, for an appointment spoken in
  September 2026. It went into the live care record and the family saw it as real. A tool
  description can say "use today's date". It can't say what today's date is. Every MCP
  server dealing with "tomorrow" or "next week" has this problem now, and each one is
  patching it by putting the date into a prompt it may not control.
- **Instead:** We put the date and the household's timezone into the planner prompt we own,
  read timestamps without an offset as household time, and refuse any date more than two
  days past or a year ahead.

### A speaker hint that's clearly just a hint
- **Urgency:** important
- **What:** An optional field where a host can say "I think this turn is from profile X",
  defined as evidence, not proof.
- **Why it matters:** Families share devices. On a living-room Echo the credential
  identifies the household, and the person talking changes every turn. Permissions have to
  stay tied to the credential, because a model can be talked into believing anyone is
  speaking. But a weak hint, which a server could treat as `INFERRED`, would let a shared
  device stop asking "who is this?" every turn. Our trust model already ranks evidence by how
  sure it is, so we'd use this properly, and so would anyone who needs it.
- **Instead:** One session per member, picked on purpose.

### A way to mark tool output that a person wrote
- **Urgency:** important
- **What:** A `_meta` flag or content annotation meaning "a person typed this, the server
  didn't write it".
- **Why it matters:** Hosts fairly trust what a trusted server returns, but servers now
  return other people's words more and more. A care note from a paid aide travels the same
  way as text the server wrote. As more servers pass along what users wrote, "all tool output
  is equally trustworthy" stops being a safe default, and a server has no way to say
  otherwise.
- **Instead:** We never put free text into instructions, and every change needs a tool call
  that the permission check approves on its own.

### A table of which spec versions each SDK release supports
- **Urgency:** nice-to-have
- **What:** A published list of SDK release -> supported spec versions.
- **Why it matters:** We had to target spec 2025-11-25. Finding which SDK release supports
  it meant grepping compiled code. See the friction log.

---

## Alexa+ / Amazon add-ons

### A local simulator for add-on conversations
- **Urgency:** critical
- **What:** An official local tool that runs an MCP server against the real Alexa+ planner
  and speech, with no invite or device needed.
- **Why it matters:** Add-ons are invite-only, and Amazon said at office hours that you can't
  drive an Echo Show from an SDK yet. Everyone outside the preview is guessing how Alexa+
  will choose between their tools, how it will word results, and where it will get confused.
  We built our own simulator, which means we're tuning against our model's behaviour, not
  Alexa's. If add-ons are meant to be open to everyone, this is the biggest gap.

### Guidance on writing tool output that will be spoken
- **Urgency:** important
- **What:** Documented advice for tool output that gets read aloud: how long is too long, how
  lists are read, whether the model rewords or reads as written, how to mark a question back
  to the user.
- **Why it matters:** Voice has limits a chat window doesn't. Four open care tasks read aloud
  is fine; fourteen is useless. We're guessing where the limit is. Every add-on developer
  will guess differently, and users will notice.

### Elicitation expects a request to stay open; a voice turn can't
- **Urgency:** important
- **What:** Guidance, or something in the protocol, for elicitation where one request can't
  stay open while a person answers. Voice is the clearest case.
- **Why it matters:** MCP elicitation expects the answer inside the same `tools/call` that
  asked. An Alexa turn ends in seconds, so the two disagree about how long a request can stay
  open. Someone who put an Alexa Skill in front of MCP servers hit exactly this, and had to
  park the open call and pick it up on a later turn. CareCircle avoids it by making
  confirmation its own tool call (`confirm_proposal`): "will Mom need a ride?" then "yes"
  works however long the gap is, with nothing parked. It works, but it's working around a
  protocol assumption that doesn't hold for voice. Either document the pattern, or let a
  server mark a tool's elicitation as something that can be answered later.

### Confirmation before actions that matter
- **Urgency:** important
- **What:** A documented contract for how Alexa+ shows MCP elicitation, and whether a server
  can require confirmation before a change.
- **Why it matters:** CareCircle decides who is responsible for parts of someone's medical
  care. If a model mishears and gives Thursday's hospital run to the wrong person, that's a
  real-world problem, not a bad chat reply. Servers whose actions matter need a confirmation
  step they can rely on, not a convention.

### Rich cards: a way to show MCP results on screen
- **Urgency:** critical
- **What:** A way for an MCP server to return something Alexa+ can draw on a screen device (a
  card with fields, status and buttons) alongside the spoken text, falling back to speech on a
  device with no screen.
- **Why it matters:** This was the biggest limit we hit. CareCircle's main answer is a ranked
  list: four care tasks, each with how serious it is, who has it (or that nobody does), when
  it's due and why. Spoken, people can hold about three before they lose track. On a screen,
  a family takes in twelve at a glance and points at the one they mean. Today we have to
  squash it all into a sentence, which throws away the structure that makes it useful. We
  work out `severity`, `because`, `dueAt` and `owner` for every task and then drop them when
  we speak.
- **What we'd want:** `structuredContent` is already in the spec and already carries this
  data. What's missing is an agreed way to draw it: a schema, or a few card types (list,
  detail, confirmation, status) a host knows how to show, so servers don't each invent one
  and hosts don't have to guess.
- **Instead:** We read out three items and say how many more there are, and we draw our own
  cards in our simulator to show what it should look like.
- **Update (2026-09-18):** The drawing contract we asked for now exists in MCP: the MCP Apps
  extension (SEP-1865), and we've shipped on it. Our `get_care_gaps` is an MCP App. It points
  at a `ui://` resource, and a host that supports the extension draws the ranked board, with
  where each fact came from, the ranking's maths open to inspect, and a Claim button that
  calls `claim_obligation` back through the host. So the protocol half of this request is
  done, and we'd rather say so than keep complaining. The half that's still open is Amazon's:
  Alexa+ supporting the extension, so the same view a desktop host already shows can appear
  on an Echo Show, and fall back to our speech on a device with no screen. We built the card
  once, to the open standard. We're asking for it to show up where the family actually is.

> *This one frustrated us most, because we could see the better product just out of reach.
> We work out a ranked list with seriousness, owner, due time and a reason for every task,
> then flatten it into a sentence and throw the structure away. Part of why we built the care
> board in our own simulator was that we didn't want the most useful thing we make to end up
> as audio only.*

### Cards that carry the next tool call
- **Urgency:** important
- **What:** Cards whose buttons call a named tool with its arguments filled in, like a Claim
  button on a care task that calls `claim_obligation` with that task's id.
- **Why it matters:** "I'll take the cardiology one" needs the model to work out which item
  "the cardiology one" means, and sometimes it gets it wrong. When the action is taking on a
  hospital trip, sometimes wrong isn't good enough. A tap is clear. Voice is great for saying
  what happened and poor for picking between similar items, and a good design uses each for
  what it's good at.
- **Update (2026-09-18):** MCP Apps answers this too, and better than we asked. We wanted a
  card that could carry a tool call. The extension gives the view a real client, so our Claim
  button makes a real `tools/call` through the same permission checks as speech, with no
  second, weaker set of rules for taps. The one thing we had to add was telling the model
  afterwards (`ui/update-model-context`), or it keeps offering tasks someone already took.

### Confirmation shown on screen
- **Urgency:** important
- **What:** A confirmation step the host draws for important tool calls, showing what's about
  to happen and who it affects, before it happens.
- **Why it matters:** It's close to elicitation, but the point here is the display: before
  Thursday's eye clinic run is given to Musa, Musa's name should be on the screen. See also
  the confirmation request above.

### Something to glance at, not just conversations
- **Urgency:** nice-to-have
- **What:** A way for an add-on to put something on a device's home screen, the thing a
  screen shows when nobody is talking to it.
- **Why it matters:** CareCircle's most useful moment isn't a conversation. It's someone
  walking past the kitchen Echo and seeing that Thursday still has no driver. Looking after
  someone mostly happens in the background; talking to the assistant is the exception. Every
  assistant integration we've seen assumes the conversation is the product.

### Tell an add-on each speaker's language
- **Urgency:** important
- **What:** Alexa+ should tell the add-on the language of the person speaking (for example
  `es-US`), per turn or per recognised voice profile. Today, if anything is sent, it's the
  device's locale.
- **Why it matters:** Families looking after someone often speak more than one language. In
  the US, 5.6M people over 65 speak English "less than very well", 2.9M of them Spanish
  speakers (ACS 2024, B16004). A common case is a parent speaking Spanish and grown children
  speaking English, sharing one Echo in bilingual mode. Alexa+ itself is launching in
  Spanish, French, Portuguese, German, Italian and Hindi. When we tested our add-on, the
  problem wasn't how replies were worded. It was the record:
  - A mother said "colírio" or "gotas para los ojos", and the planner passed that name to
    the tool.
  - It didn't match anything on her schedule, so her son was told there was no record of
    the dose she'd taken. That happened in 10 of 11 languages (`npm run evals:languages`,
    part 2).
  - We fixed it on the server. An unmatched name now gets back the names on that person's
    schedule, so the planner can try again with the right one.
  - Only the host knows who is talking and in what language, and it doesn't tell us.
- **Instead:** Each member picks a language in Telegram (`/language`). Every reminder, button
  and reply follows that person's choice, not the device's. The rule lives in one place,
  `src/domain/language.ts`: medicine names and times are never translated, and "no record"
  never becomes "missed".

---

## AWS (Transcribe, Polly) and Ring

### Nigerian English (`en-NG`) in Amazon Transcribe
- **Urgency:** important
- **What:** An `en-NG` locale, like `en-ZA`, `en-IN` or `en-AU`. After that, Yoruba and Igbo,
  each spoken by tens of millions. `ha-NG` (Hausa) already exists, so Nigerian languages are
  clearly possible.
- **Why it matters:** Nigeria is the biggest English-speaking country in Africa and one of
  the biggest anywhere, and there's no English option for it. A Nigerian speaker gets a model
  tuned for somewhere else. It goes wrong most on names: if a care system mishears "Adaeze"
  or "Oluwaseun", a medicine gets put against the wrong person. It's a quiet accuracy cost
  for a whole region, and overall benchmarks don't show it.
- **Instead:** A custom vocabulary built from each household's care record, and a phonetic
  repair step that maps a mishearing back to someone who's actually in that household. The
  custom-vocabulary API did most of the rescuing. The gap is coverage, not capability.

### "Send a test event" in the Ring Developer Portal
- **Urgency:** important
- **What:** A test button for each event type in the staging tab that sends a properly signed
  event to the registered webhook.
- **Why it matters:** Ring's staging is described as testing with real devices, while the
  hackathon allows a simulator and says no device is needed. Those don't line up, and what's
  in between is buying hardware before you can build. Signed test events are what people
  expect from a webhook API.
- **Instead:** We wrote a device simulator that builds events in Ring's documented shape and
  signs them with the real partner HMAC key, so signature checks, de-duplication and
  inference run exactly as they would for real Ring traffic.

---

## AWS (Bedrock)

These come from the friction log. The Bedrock quota problem cost us most of a day, and the
fixes are small.

### Show me my daily token budget before I use it
- **Urgency:** important
- **What:** Show daily token use and what's left in the Bedrock console, and in an API that
  plain Bedrock access can read, like Service Quotas already does for request rates.
- **Why it matters:** We ran a batch eval and every call failed with
  `ThrottlingException: Too many tokens per day`. No number, no reset time, nowhere to look.
  You learn the limit by hitting it and learn it reset by trying again. For anything that
  makes lots of calls (evals, backfills) you can't plan.
- **Instead:** We left throttled cases out of the results and spaced calls out by hand.

### Tell "zero quota" apart from "used-up quota"
- **Urgency:** critical
- **What:** Make the error class and message different for a budget that's used up and an
  account whose quota is zero. A permanent zero shouldn't come back as a retryable
  `ThrottlingException`.
- **Why it matters:** Our account's inference quota was 0, against a default of a million, but
  the error said "too many tokens per day". So we spent hours looking for something that had
  used up a budget we never had. Clients retry throttling automatically, which for a zero
  quota means retrying forever. The two situations are opposites, and only one is worth
  waiting for.
- **Instead:** We built a preflight check ([`docs/FRICTION-LOG.md`](FRICTION-LOG.md)) that
  reads applied vs default quota and tells the developer which case they're in, so the app
  explains the failure instead of telling them to wait for something that won't come.

## Strands Agents (TypeScript SDK)

### Let an after-model hook replace the reply, not just retry
- **Urgency:** important
- **What:** A writable result on `AfterModelCallEvent` ("end the turn with this message"),
  next to the existing `retry` flag.
- **Why it matters:** CareCircle never lets a reply say someone missed, skipped or forgot
  something (`src/strands/no-blame.ts`). If a model blames someone twice, the safe thing is
  to end the turn with what the tools said. In 1.19.0 `stopData` is read-only and `retry` is
  the only option, so a guardrail that wants to swap in a reply can't say so directly.
- **Instead:** We set `retry`, then cancel the next model call from `BeforeModelCallEvent`
  with our text, which the loop treats as the model's reply. It works and it's tested, but
  it takes two hooks and a flag passed between them to say one thing.

### A note for the retry that doesn't stay in the history
- **Urgency:** nice-to-have
- **What:** A way to add a one-off note to a retried model call ("your reply said X; answer
  again from the tool results") that the model sees once and the conversation doesn't keep.
- **Why it matters:** `retry` sends the same request again. A retry that tells the model
  nothing new usually gets the same reply.
- **Instead:** The plugin adds the note to the last message in `agent.messages` and puts the
  original back after the call, so the next turn never sees it. Tests check the history is
  clean afterwards (`src/strands/host.test.ts`).

## Bedrock AgentCore

### Say how long a session's state lives, next to the session header
- **Urgency:** important
- **What:** One page that says, for `x-amzn-bedrock-agentcore-runtime-session-id`, how long a
  session's microVM and its in-memory state last, and what happens to a turn in progress when
  it's reclaimed.
- **Why it matters:** On the bridge, the session id was the hashed user id, so one microVM
  served a user for hours, through four deploys of new code. A care conversation also has to
  be short on purpose (yesterday's "no record yet" isn't true tonight), and the record itself
  must never live in the container. We had to decide both without knowing the platform's
  own limits.
- **Instead:** `src/strands/runtime.ts` keeps one conversation per session and speaker, drops
  it after 30 minutes idle or 4 hours old, reads the care record fresh from DynamoDB before
  every turn, and answers `/ping` with `HealthyBusy` while a turn is running.

### Memory you can tell what not to replay
- **Urgency:** important
- **What:** A way, per event or per namespace, to stop AgentCore Memory replaying an agent's
  own earlier answers about things that change.
- **Why it matters:** On the Alexa Skill bridge, a fresh microVM answered "who is covering
  the eye clinic appointment" without calling any tool, using history restored from
  AgentCore Memory. That history keeps the questions and answers but not the tool calls
  behind them, so the model treated an old answer as fact. A prompt rule ("call the tool
  again") didn't stop it. For a care record, an old answer is a wrong answer.
- **Instead:** We turned replay off on the bridge, and the CareCircle runtime doesn't use
  AgentCore Memory. The care record is the memory, and every turn reads it fresh.

## Amazon Nova on Bedrock

### Keep reasoning out of the reply text
- **Urgency:** important
- **What:** Return Nova's `<thinking>` text as a reasoning content block, the way Converse
  does for other reasoning models, never inside the text block.
- **Why it matters:** On a speaker, the text block is what gets read out. Nova Lite, run
  through our AgentCore container locally, started its answer with its reasoning, in tags,
  talking about the family by name.
- **Instead:** `src/domain/speakable.ts` strips reasoning tags (closed or left open) from
  every reply on both planner loops, with tests.
