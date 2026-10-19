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
| dark (over `#ffffff`) | `rgba(5,8,13,0.75)` | 7.04 | 5.19 | 3.01 |
| light (over `#000000`) | `rgba(248,250,252,0.76)` | 9.36 | 4.85 | 3.04 |

**Reduced motion means no live blur.** `--glass-blur: 0` and a more solid sheet, rather than a
smaller radius, which costs the same and looks worse.

## Consequences

- The wallpaper is atmosphere, not a gallery. That is the price of the floor, and it is why
  there is no "photo fidelity" setting: the setting would exist only to break the guarantee.
- `globals.css` owns the tokens and the backdrop; the injected sheet owns the rules. Folding the
  sheet into the Tailwind layer is a separate change, deferred — `frostContract.test.ts` reads
  both files so they cannot disagree in the meantime.
- The claim that the build stripped `.glass-ui` backdrop-filter was false (the built CSS carried
  the rail's rule). The sheet is still injected, for the folding reason above.
- The night dimmer stacks on top of the veil; the veil is sized with the dimmer at 100 %.
