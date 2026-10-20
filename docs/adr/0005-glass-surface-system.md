# The glass theme is one sheet, one blur, and a stated readability floor

The glass theme had no surface system: a rail card drawn inside a window card, four blur values
(40 / 28 / 12, and `none` on the composer) spread over two stylesheets, a three-hue radial
backdrop behind every accent in the product, and a wallpaper drawn raw behind text. Each of
those was defensible alone; together they made the theme read as a navy wash with outlines, and
made "is it readable?" depend on which photo the user happened to pick.

## Decision

**One sheet per window.** `.glass-shell` is the only glass surface and carries the app's only
`backdrop-filter`. The rail is a flat region of that sheet, marked by a `--glass-divider` rule,
not a second card. Everything inside the sheet is a *surface*: it spends fill, never blur.

**Three levels, and the old names as aliases.** `--glass-base-fill` (the sheet),
`--glass-surface-fill` (regions and cards inside it), `--glass-overlay-fill` (anything carrying
text over the backdrop, at 95 % opacity). `--glass-fill` and `--glass-fill-strong` still resolve
to the first two, because dozens of components read them.

**Two backdrop states, both stated.** Without a wallpaper the backdrop is one calm field in one
hue (two gradient layers). With one, the window draws an *ambient derivative*: downscaled to a
1600 px longest edge with the blur baked in by a canvas, memoised, derived lazily so wallpapers
stored before this change are covered. A veil over it brings any photo into a readable luminance
range. Animated images become their first frame, and the picker says so.

**The floor is measured, not asserted.** The veil values were raised until the *dimmest* text
token cleared its WCAG floor over a pure-white (dark theme) and pure-black (light theme)
photograph — the two extremes no photo can exceed. That is why they are high: a mid-luminance
backdrop cannot carry both dark and light text at 4.5:1, so the photograph has to be pushed to
one end. `lib/glass/contrast.ts` does the arithmetic, and its test pins both the WCAG reference
values and the theme's own numbers.

| theme | veil | primary | secondary | muted |
|---|---|---|---|---|
| dark (over `#ffffff`) | `rgba(5,8,13,0.82)` | 8.90 | 6.56 | 3.80 |
| light (over `#000000`) | `rgba(248,250,252,0.76)` | 12.46 | 6.46 | 4.05 |

Each number is the text token composited over the sheet fill over the veiled photograph, and the
test now derives it from the tokens the stylesheet actually ships - see the revision below.

**Reduced motion means no live blur.** `--glass-blur: 0` and a more solid sheet, rather than a
smaller radius, which costs the same and looks worse.

## Revision: the first pass read as a flat slab

The rules above are the right frame, but shipping them made the theme *duller* than the plain
dark theme it replaced, and the screenshot at 1024×768 made it obvious why. Four things were
wrong, and each was a consequence of over-applying "the sheet is the only surface":

1. **The controls were flattened with the sheet.** The frost sheet set every chip, trigger and
   field to `transparent`, including the composer's toolbar. A control without a fill is bare
   text: affordances disappeared, and the theme read as the plain theme minus its edges. Controls
   are now their own level - except the model selector, which is the header's widest control and
   whose filled pill read as a raised slab on an otherwise flat header: it keeps no fill at rest
   and only a hover fill, like the header's icon buttons.
2. **The rail was invisible, not flat.** "Region, not card" was implemented as "no fill", so the
   rail and the content had the same tone and only a hairline divider separated them. The
   navigation rail is a *tint of the backdrop's ink* (`--glass-rail-fill`) with the sheet's
   corner radius - still no border, shadow or blur of its own. The content rails are not: the
   conversation list and the settings rail are content inside the sheet rather than chrome, and a
   tonal step right next to the message column read as a gap, so they stay transparent with
   their divider as the only boundary. The conversation list's drag handle no longer paints
   `slate-900` either - that left a 4px black slot between two surfaces of the same tone, which
   is the most literal version of the same complaint.
3. **The current page had no mark.** The nav's active state was stripped along with the rest and
   left as a hue shift of a few percent on the glyph. It is now the rail's single raised mark
   (`--glass-active-fill`), which is what a rail is for.
4. **The field had no light.** A smooth one-hue wash is invisible through a frosted pane, so the
   sheet could only be flat. The field now carries a light source and a fall-off (still two
   layers, still one hue), the sheet spends a matching top `--glass-sheen`, and its border,
   inset highlight and shadow are sized to show the edge.
5. **The sheet was rounded twice.** `.glass-shell-inner` carried `border-radius: 16px` plus
   `overflow: hidden`, and it is inset by the sheet's border and the rail's padding - so its
   clip landed in the middle of the settings rail and drew a rounded corner *inside* the
   sheet's own. The sheet now owns the clip (`overflow: hidden` on `.glass-shell`) and the inner
   container has no radius. The settings cards also held three radii at once - `rounded-lg`
   (10px), `rounded-xl` (12px) and `rounded-2xl` (16px) - and the 16px card equalled the window
   radius, which is what made it read as a window nested in the window; settings section cards
   are one radius now.
6. **The settings page drew a scrollbar it did not need.** The page still scrolls by wheel,
   trackpad and keyboard; the 6-8px bar over the sheet did not earn its place, so the settings
   scroller hides it - by name, because the sheet sets `thin` on every element and Chromium
   prefers that property over `::-webkit-scrollbar` when both apply.

7. **The veil was measured against a stale fill.** The test that pins the floor restated the
   veil and fill values it was written against instead of reading the stylesheet, so when the
   fills moved the check kept passing while the window drifted. The acceptance screenshots found
   it: dark theme over a near-white wallpaper put muted text at **2.75:1** in the rendered
   window (modelled 2.92:1 with the shipped 0.08 sheet fill), under the 3:1 floor. Two things
   changed - the check now reads `globals.css` and walks every fill the theme paints text on
   (base, surface, control), and the dark veil went 0.75 to 0.82 while the dark surface fill
   came down to 0.06 so a card no longer lightens the backdrop past the floor. Measured again on
   the same backdrop: muted 3.48:1, secondary 5.24:1, primary 6.32:1.

Light and dark are tuned separately because the physics differ: in dark the sheet *lifts* off a
near-black field (0.08 white), in light it is a bright pane on a cool field (0.74 of near-white),
and the field itself is what makes light mode read as glass rather than as a white page.

The controls, the rail tint and the active mark are fills. The blur count is still one; the
wallpaper, the veil, the overlay opacity and the overflow rules are unchanged.

## Consequences

- The wallpaper is atmosphere, not a gallery. That is the price of the floor, and it is why
  there is no "photo fidelity" setting: the setting would exist only to break the guarantee.
- `globals.css` owns the tokens and the backdrop; the injected sheet owns the rules. Folding the
  sheet into the Tailwind layer is a separate change, deferred — `frostContract.test.ts` reads
  both files so they cannot disagree in the meantime.
- The claim that the build stripped `.glass-ui` backdrop-filter was false (the built CSS carried
  the rail's rule). The sheet is still injected, for the folding reason above.
- The night dimmer stacks on top of the veil; the veil is sized with the dimmer at 100 %.
- The window's own size is not part of the theme. On a 1536×864 display at 125 % scaling the
  logical desktop is 1228×691, so the 1024×768 window preset does not fit and its bottom and
  right edges fall outside the screen — which is easy to mistake for a glass layout bug. The
  screenshot pass has to resize the window to the work area before judging the theme.
