# Open Source mini-challenge - submission

**Published:** https://github.com/Osiyomeoh/household-sim (public, MIT).

## The contribution: household-sim

A new, standalone, MIT-licensed tool that tests an MCP server the way a household uses
it. It is CareCircle's simulator with CareCircle taken out, so it works for any MCP
add-on, not only ours.

It typechecks under `strict` + `exactOptionalPropertyTypes`, ships 35 `node:test`
tests, and has its own GitHub Actions workflow on Node 22 and 24. That workflow also
replays the example scenarios against the real example server.

## What / how / why (the required submission fields)

**What.** A command-line tool and library with two commands:

- `check <url>` connects to any MCP server and reports what a voice host and its model
  would trip on: no sign-in challenge, an old protocol version, tool names some model
  APIs refuse, missing or thin descriptions, arguments with no description, broken
  schemas, missing `readOnlyHint`/`destructiveHint`, and a tool list too big to send
  every turn. It needs no model.
- `run scenarios/*.yaml` plays a household story against the server. Several people
  each connect with their own credential, a model plays the assistant using only the
  server's own tool descriptions, devices send signed webhooks, and a story clock moves
  time forward. Every step passes or fails, with console, JUnit and JSON output.

It comes with a small example add-on, `house-rota`, set in a Nigerian home: Ada, Tunde
and Grandma share the generator fuel, the bins and the water tank, and a fuel gauge
reports when the generator runs low. There are three scenarios against it.

**How.** Each member is a real MCP client over Streamable HTTP with its own bearer
token, so the server always knows who is speaking, as it would with a real host. A
model (Amazon Bedrock, any OpenAI-compatible endpoint, or a local Ollama) chooses the
tools. Nothing is scripted on the server's side, so how well the model chooses is a
direct test of how well the tools are described. A run can be **recorded** once and
**replayed** in CI: the model's choices are played back, while every tool call still
goes to the real server. A replay costs nothing and needs no credentials. It refuses
to pass when the scenario has changed under it, or when a recorded call names a tool
that no longer exists. When a tool's description changed after the recording, it runs
but says so.

**Why it matters.** The bugs that hurt a voice add-on most only appear with several
people, a model choosing the tools, devices changing the record between turns, and
time passing. CareCircle's worst one put an appointment on the family's board dated
19 December 2024, because the model was never told today's date. Unit tests do not
reach these bugs, and testing by hand on a speaker is slow and hard to repeat. At
office hours a judge warned about untested AI-written code landing on open-source
maintainers. This tool lets the author of an MCP server test their own work first, in
CI, before anyone else has to.

The README says plainly that it is a stand-in for a voice host, not Alexa+, and that a
real host's planner will not choose exactly the same.

## Submission form fields

- **Contribution URL:** `https://github.com/Osiyomeoh/household-sim`
- **Project repository URL:** `https://github.com/Osiyomeoh/household-sim`
- **GitHub username:** `Osiyomeoh`
- **Description:** the What / How / Why above, condensed to a paragraph.

## Also published

`@carecircle/care-events` (https://github.com/Osiyomeoh/care-events, MIT) is a smaller
package: one adapter seam that turns device signals (voice, wearable, doorbell) into a
single `CareEvent` contract, with a provenance model that never lets a guess become a
fact. It lives in this repo at [`packages/care-events`](../packages/care-events), with
5 tests. It was the planned entry until household-sim was ready, and stays public.

## Rubric note

The Open Source rubric calls a "meaningful feature addition with tests" or a "new
integration pattern" *creative*, versus a README/typo fix as *obvious*. household-sim
is a new, tested tool that other MCP authors can run in their own CI.
