# Real-family pilot kit

The goal: one real family runs CareCircle for 1-2 weeks, so the submission shows a real
person using it, not only a demo household. Real usage is the strongest Impact evidence a
judge can see, and very few entries will have it.

Target: a family caring for an older relative across more than one home, which is common
in Nigeria where children and relatives coordinate care from different cities. They
already coordinate on Telegram or WhatsApp groups, so CareCircle meets them where they are.

---

## 0. Consent first (do not skip)

This is a real person's care, so:

- Get a clear yes from the person being cared for **and** each family member before
  adding them. Explain: what is recorded, who sees it, and that they can leave any time.
- Keep health detail minimal: "evening eye drops" is enough; no diagnoses, no records.
- Ask separately before filming anyone or showing their name in the video. Offer first
  names only or a pseudonym.
- At the end, offer to delete their household. Tell them you will.

## 1. Create their care circle (10 min, the primary caregiver does it)

1. Open `https://krqi2tpsif.us-east-1.awsapprunner.com/setup`.
2. Create the circle (name + timezone, e.g. `Africa/Lagos`), then add each member: the
   person being cared for, the family members, any paid helper.
3. Add medications and any known appointments.
   - **Family abroad** (e.g. a brother in the UK): add them by voice or text in the
     console, e.g. *"Add my brother Kunle as a caregiver. He lives in London and wants an
     update every evening."* That sets `livesAway` and `dailyUpdate`. From then on he
     gets a short update on the day after 21:00 household time, and CareCircle never
     picks him on its own for rides or pickups. Map his Telegram in step 2 so the update
     reaches him; unmapped, it is only written to the care log.
4. Tell the operator (you) it's done. The operator pulls the new household id and member
   ids (they are random `h_...` / `m_...` ids returned by setup).

## 2. Put the bot in their family group (10 min)

1. Create a Telegram group (or use their existing care group) and add
   `@carecircle0111_bot`.
2. Operator runs, from the repo root:

   ```bash
   npm run telegram:ids
   ```

   then asks everyone to post "hello" in the group within 2 minutes. It prints the group
   id and each person's Telegram id, then puts the webhook back automatically.
3. In `.env`, point the live doors at the pilot household:

   ```
   TELEGRAM_GROUP_CHAT_ID=<group id>
   TELEGRAM_RECIPIENTS={"m_<member>":"<telegram id>", ...}
   TELEGRAM_HOUSEHOLD_ID=h_<their household>
   ```

4. Redeploy env with the vars exported (so every secret is "set from this shell"):

   ```bash
   set -a; . ./.env; set +a; AWS_PROFILE=conductor bash infra/deploy-mcp.sh
   ```

> **One household at a time.** Telegram replies route to a single
> `TELEGRAM_HOUSEHOLD_ID`, so during the pilot the live Telegram door belongs to the pilot
> family. The demo household still works in the console. Record any demo-household
> Telegram scenes before switching, or switch back afterwards.

## 3. What the family does day to day

Nothing special, which is the point:

- Say or type what happens in the console ("Mum took her evening pill", "She has the
  clinic Thursday at 10").
- When CareCircle asks someone in the group ("can you take ...?"), they reply **yes** or
  **can't** in Telegram.
- Once a day, anyone can ask "what needs doing?" and see what nobody owns.

## 4. What to capture (this is the evidence)

Keep a log in `docs/pilot/LOG.md` (template below). Aim for:

- [ ] At least 5 real asks answered in the Telegram group (screenshots, names blurred
      unless consented)
- [ ] One "save": something that would have been missed or double-handled without it
- [ ] Counts at the end: asks sent, answered, time to answer, gaps closed
- [ ] One 10-20 second quote on camera (consented): what changed for them
- [ ] Anything that confused them (also great friction-log material)

### Log template (`docs/pilot/LOG.md`)

```
## Day N - YYYY-MM-DD
- What happened:
- Asks sent / answered (who, how fast):
- Anything missed or saved:
- Confusion or friction:
- Quote (if any):
```

## 5. Close out

- Tally the numbers into the README Impact section and the video.
- Ask whether they want to keep using it, and record the answer honestly.
- Delete their household if they ask, and point the live doors back at the demo household.
