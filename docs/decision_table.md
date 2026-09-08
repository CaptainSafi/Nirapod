# Decision table

For every kind of claim the site can receive: what may be published, at what
resolution, and what has to be true before it publishes at all.

This is the moderator's reference. The schema implements this table; where the
two disagree, this table is right and the schema is a bug.

---

## 1. The distinction everything hangs on

**"What happened to me"** — first-person experience. I was mugged here. They
demanded money from my shop. The police would not take my GD.
→ Publishes on threshold alone. The submitter is describing their own life.

**"Who did it" / "where they are"** — a claim about another party. That group
runs this area. Stolen phones end up in that market. They operate out of that
building.
→ Never publishes on one person's say-so. Requires independent corroboration
from **distinct submitters**, *and* coarsening, *or* it goes to the sealed tier.

The reason is not legal caution. The first is testimony; the second is an
accusation, and an accusation fixed to a place or a name is something a crowd
can act on. We cannot verify either — but only one of them gets someone hurt
when it is wrong.

## 2. Witnessed vs inferred

**Witnessed** — the submitter was there. It is their account of their own
experience.

**Inferred** — derived, by them or by us, from something other than presence: a
phone's last known location, a pattern across many reports, a conclusion drawn
from where things end up.

Inferred claims live in **separate tables** from witnessed ones. They are not
worse data; they are a different kind of claim, and mixing them in one table is
how an inference eventually gets rendered as an eyewitness fact. No inferred
row appears in public JSON without passing the rules below.

## 3. The table

| Claim | Witnessed / inferred | Geography | Threshold | Publish / coarsen / seal | Corroboration required |
|---|---|---|---|---|---|
| **Extortion** (chadabaji) | witnessed | **thana — never ward** | 5 per thana per quarter | publish, coarsened | none for the incident; **≥2 distinct submitters** to attach a named group |
| **CCTV point** | witnessed (observable public fact) | **exact point** | none | publish **presence only** | none |
| **Snatching hotspot** | witnessed | ward | 5 | publish | none |
| **Recovery destination** | **inferred** | thana | 20 | publish as **flow**, coarsened | inherent in the threshold — 20 distinct submitters |
| **Police non-response** | witnessed | thana (the institution) | 10 | publish, names the institution | none — a public body, and the submitter's own experience |
| **Den inference** | **inferred** | — | — | **seal — not rendered** | n/a |

## 4. Why each row is set where it is

### Extortion — thana, never ward
A ward plus a business type plus an amount identifies a specific shopkeeper to
the people collecting from them. There are not many construction sites in one
ward. That is why the geography is coarsened to thana, why amounts publish as
bands rather than figures, why the window is a quarter rather than a week, and
why there is **no time-of-day split** — cadence plus time of day plus ward is a
collection round, and publishing a collection round tells the collectors which
shopkeeper talked.

A median publishes only at n≥10. A single report never contributes a visible
figure.

### CCTV — publish presence, never absence
A camera on a public street is an observable fact with no victim in it, so it
takes the hazard treatment: exact point, auto-publish, no threshold.

**The absence of cameras is not published in any form.** No gaps overlay, no
dark-area styling, no "coverage" heatmap that reads as one, no ward shading
that inverts to the same picture. A map of where nobody is watching is a
route-planner for exactly the crimes this site exists to reduce. Ward-level
density belongs on the methodology page as a number, not on the map as a layer.

Working state is recorded because a dead camera is a false sense of safety —
but it is shown per-point, never aggregated into a coverage picture.

### Snatching — ward, standard threshold
Ordinary area crime. The place is the point, the pattern is what makes it
useful tonight, and the existing "how it happened" screen carries the method
split (pillion / on-foot / bus window / rickshaw). Nothing new is required.

### Recovery destination — flow, not pins
Theft ward → last-known ward is an **inference about where stolen goods go**,
and the destination is somebody's workplace. A pin dropped on a market is an
accusation against every trader in it, most of whom have done nothing.

So: thana level, threshold 20, and rendered as a **flow** — a direction between
areas — never as a marker on a location. Twenty distinct submitters is the
corroboration; below that it does not exist publicly.

### Police non-response — the accountability surface
Naming a thana is fair comment on a public body, and this row is the reason the
site is citable rather than merely alarming. It is the submitter's own
experience of an institution, so no corroboration gate — but the existing
higher threshold (10) stays, because the population who had that specific
interaction with that specific thana is small.

### Den inference — sealed
"They operate out of that building" is the single highest-risk claim the site
can carry. It is an inference, it points at a fixed address, and it is
actionable by a crowd within the hour. It goes to the **sealed tier**: collected
if someone wants to tell us, encrypted to a partner's key, never rendered.

If that is overruled, the only survivable form is thana level — and at thana
level it says exactly what recovery destination already says, so it should be
folded into that row rather than published as a second, scarier-sounding
layer. **A separate "dens" layer at any resolution is not on the table.**

## 5. If in doubt — the ladder

Work down this list. Stop at the first line that applies.

1. Does the claim name or locate a **person**? → sealed tier. Not a publishing
   decision.
2. Is it **inferred** rather than witnessed? → coarsen one level beyond what the
   threshold alone would allow, and check it renders as a direction or an area,
   never as a point.
3. Does it name a **group**? → it needs a register entry with ≥2 independent
   citations, and ≥2 distinct submitters. No register entry, no name — the
   report still counts toward the thana total.
4. Does it name an **institution** (thana, city corporation)? → allowed, at its
   threshold, with a dispute route on the page.
5. Is it the submitter's **own experience**, with no other party located? →
   publishes on threshold at its normal geography.
6. Is there **no victim at all** (hazard, CCTV point)? → exact location, no
   threshold, publish.

## 6. What this table does not decide

- **Named individuals.** Open — see the register spec. Convicted-only is a
  public court record; charged is not, and aggregating reports under a charged
  person's name publishes a verdict no court has reached.
- **Who clears the queue.** Every row above assumes a moderator exists.
