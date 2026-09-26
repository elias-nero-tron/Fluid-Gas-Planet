# How we work: build new tracks instead of making things worse

German: [de/PROZESS.md](de/PROZESS.md).

Until v0.2 this happened: the author reported observations, the assistant “fixed” each one, and at the
end the project had moved three steps forward in one place and three steps back in another (v0.2.1
over-corrected the look, see [STATUS.md](STATUS.md) finding 7). These rules exist to stop that.

## 1. Observations are not bug reports

A comment like “the storms only last 2–3 seconds” is an **observation**. It first gets an explanation
(what in the code or maths causes it). Only then do we decide whether to change something, and how.
Every observation goes into [STATUS.md](STATUS.md) with its cause, even if nothing changes.
On GitHub: open an issue with the “Observation” template, ideally with a film strip (below).

## 2. Tracks (“Schienen”) instead of rebuilds

A working look is never replaced. New ideas get **their own track** next to it:

| Track | What it is | Shares with others |
|---|---|---|
| Fluid | Stable Fluids + dye (mofu), v0.1 look | sphere, lighting |
| Particles | curl noise + pure particles (jasper-r) | sphere, lighting |
| Hybrid | v0.2 free combination, kept for old planet codes | everything |
| Terrain clouds | `demos/terrain.html`, separate page | nothing |
| Coffee | `demos/coffee.html`, test bed for sources and limiters | nothing |

A track may only become the default once it has been compared on real hardware against the current
default and the author agrees (CONTRIBUTING: “look first for defaults”).
Changing a shared part (geometry, lighting) requires a film strip of **every** track before and after.

## 3. Defaults are protected

Defaults only change with a before/after film strip on real hardware. New physics arrives as a new
control, a new option or a button that applies a group of settings (and can be undone), never as a
silently changed default.

## 4. Eyes: film strips instead of single screenshots

Single frames hide motion. Both sides now use the same tool:

- **In the app:** Diagnostics → “Record film strip” saves 8 frames, 2 s apart, as one PNG with the
  settings and fps in the footer. Attach it to an issue.
- **Headless (assistant, CI):** `node scripts/eyes.mjs --preset Jupiter --track fluid --out docs/eyes/x`
  writes the same sheet plus `detail` (fine structure) and `change` (motion between frames) numbers.
  Software rendering is slow and not a replacement for hardware, but it catches regressions.

## 5. One topic per change

One pull request per topic, with a film strip in the description, and marked **verified** (device,
fps) or **unverified** (software renderer only).

## 6. Handover without the chat

Everything a new session needs is in the repository: [CLAUDE.md](../CLAUDE.md) (short rules for AI
assistants), [STATUS.md](STATUS.md) (what is known), [ROADMAP.md](ROADMAP.md) (what is next). This
follows Anthropic’s published advice for long-running agent work: keep a progress file and a feature
list in the repository, commit in small verified steps, and let the next session start from the files,
not from memory ([Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).

## What helps most from the author’s side

1. One observation per issue, with a film strip or a planet code (`FGP1:…`) to reproduce it.
2. Say what was **better** before, not only what is worse now; that is what protects the good parts.
3. Mark wishes as “later” when they are not for this round; they go to the roadmap, not into the code.
