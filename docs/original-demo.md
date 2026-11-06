# Holo-Booth: AI Photo Booth

A mall-style photo booth. The visitor takes one photo; AI turns it into a strip
of four sci-fi frames (alien, spacesuit on an alien planet, starship cockpit,
action shot). We email them the strip. Nothing is printed.

## Visitor flow (target: under 90 seconds at the screen)

1. **Attract**: live mirrored camera preview, "Strike a pose".
2. **Email first** (required): on-screen keyboard + shared consent text.
3. **Countdown**: 3, 2, 1 on the beat; at 0 the screen flashes white (camera
   flash) and the photo is taken.
4. **Review**: "Beam me up" or "Retake". One retake only.
5. **Processing**: a live view of the Temporal workflow, four frames rendering
   in parallel (thumbnails fill in as they finish), strip composed, email
   sent. If a model call fails, the step shows "retrying (attempt 2)". A big
   "Done, we'll email it" button is always there, so nobody has to wait.
6. **Result**: the strip on screen (and an animated version), "sent to
   you@example.com".

If the network is down, the visitor sees "Saved! Your holo-strip will arrive by
email once our subspace relay reconnects"; Done starts over for the next visitor.
No Holodeck screen goes back or resets on a timer; only a tap moves it.

## Surviving network loss (decided 2026-09-24)

- The API writes the photo and email to a local SQLite spool **before**
  touching the network, then starts the workflow (workflow ID = session ID, so
  repeated starts are harmless). If Temporal Cloud is unreachable, a background
  task keeps retrying the start, including after a restart.
- Once started, AI calls retry with no attempt limit (backoff capped at 60s,
  24h overall), so an OpenAI or network outage just delays the email.
- Content-policy refusals aren't retried as-is: the frame is retried once with a
  softer prompt, then a plain portrait scene, then a branded "signal lost" card.
  We never send a fake picture of the visitor.

## The Temporal story (what staff say)

"Every photo is a workflow. Four AI calls run in parallel; if one times out,
Temporal retries just that one. The other three aren't redone and you don't
get a half-finished strip. Pull the network cable and your strip still
arrives: the photo is saved here and Temporal finishes the job when we're back
online."

Temporal features shown: parallel activities, retries with visible attempts,
durable start from a local spool (works through a network outage), queries
(live progress).

## AI pipeline

**Decided: OpenAI image models are the primary provider** (`OPENAI_API_KEY`
in `app/backend/.env`). Default model `gpt-image-2.5-flare` at medium quality
(the faster of the 2.5 models; `gpt-image-2.5-sunburst` is sharper but slower).
Each frame is one edit call straight from the original photo, so no separate
background-removal step. Bedrock stays available behind
`HOLODECK_IMAGE_PROVIDER=bedrock`. Visitor photos go to OpenAI, so the
on-screen notice and OpenAI data-retention settings need legal review.

| Step | Mock (offline, default) | AWS (preferred at re:Invent) | Alternative |
|---|---|---|---|
| Background removal | Soft portrait mask (Pillow) | Bedrock: Stability **Stable Image Remove Background**, or Nova Canvas `BACKGROUND_REMOVAL` | gpt-image-1 |
| Scene frames (x4) | Procedural backgrounds + tint/overlays | Bedrock: Stability **Search and Replace** / **Structure** / **Style Transfer**, or Nova Canvas image variation / outpainting | OpenAI gpt-image-1 `images.edit` (best at keeping likeness, slower) |
| Animated strip | GIF with twinkling stars/parallax | Nova Reel image-to-video (6s clips, async, too slow for on-screen but fine for the email) | none |

- Stability Image Services on Bedrock are available in us-west-2, which matches
  our region.
- Keep likeness: for the "turn me into an alien" frame, a style/structure model
  that keeps the face works better than full regeneration. Needs a bake-off.
- Content safety: prompts are fixed by us (visitors don't type prompts), and we
  should run Bedrock guardrails / moderation on outputs before showing them.
  One bad frame on a giant screen at a public booth is a real risk.

### Latency budget

- Background removal: ~2-5s. Each frame: ~5-15s (Stability) or ~20-40s
  (gpt-image-1). Frames run in parallel.
- Target: strip ready in under 45s, which the email step mostly hides.
- Animation (Nova Reel) is async: send the static strip right away and a second
  "your holo-strip is animated" email later. That's a nice Temporal moment too
  (a long-running step that finishes after the visitor walks away).

## AgentCore fit: moderate

The pipeline is deterministic, so it doesn't need an agent. The honest fit is
**Temporal Serverless Workers on AgentCore Runtime**: the image activities run
on AgentCore-hosted workers that scale with the line at the booth. An optional
"art director" agent could pick scenes from the photo (e.g. "they're wearing a
hat, use the pirate-alien scene"), but it adds latency for little gain.

## Scope

**MVP (prototype built):** camera, countdown, flash, one retake, email via
signal, mock AI, 4-frame strip, animated GIF, local outbox email, live progress
with retries.

**Before the show:**
- Real provider bake-off (Stability vs Nova Canvas vs gpt-image-1): quality,
  likeness, latency, cost per strip.
- Output moderation step.
- Email through SendGrid with hosted image URLs (S3 + CloudFront, signed,
  expire after the show).
- Camera + lighting at the booth (ring light helps background removal far more
  than any model). Test with the actual camera.
- Privacy: photos are personal data. Decide retention (e.g. delete 30 days
  after the show), and say so on the screen.

**Stretch:** animated email via Nova Reel, a "gallery wall" attract mode on
the big screen (only with explicit opt-in), group photos.

## Open questions

- Which camera? Built-in webcams on a vertical 40" screen will frame badly; a
  USB camera on a mount is likely needed.
- Do we show the strip on the big screen to passers-by (opt-in)?
- Legal review of AI-edited images of visitors.

## Scenes and prompt style (decided 2026-09-24)

- **Inspired, not edited** (default, `HOLODECK_PHOTOBOOTH_STYLE=inspired`):
  each frame is a brand-new scene (new pose, angle, costume) featuring a
  character who looks very much like the visitor, with the photo as the
  reference image. `photo` mode keeps the old edit-the-photo behaviour.
- **18 scenes, each its own category** (cockpit, bridge captain, mech, planet
  explorer, creature battle, zero-g, spacewalk, asteroid miner, ice planet,
  alien jungle, desert world, cantina, space race, hologram, and four
  transformations). A strip takes 4 different categories, at most one
  transformation, and at most one "helm" scene (starfighter, bridge, mech),
  so no more double cockpits.
