# claude-code-web — Design system handoff

**Version** v3-design  ·  **Target** dark-only, warm palette  ·  **Inspired by** claude.ai, Anthropic brand, Raycast/Linear.

## Vision

A remote Claude Code client that feels **steady**, **warm**, and **quietly confident** — not another cold developer tool. The screen is mostly calm; motion is subtle and purposeful; the only hot color is a single coral accent reserved for user-initiated primary actions and the "something is happening" state. No emoji, no gradients, no drop-shadow excess. Typography does the heavy lifting.

Three rules everything else follows from:

1. **Content first.** The message stream gets the largest type, the most breathing room, and the simplest visual treatment. Everything else (sidebar, chrome, modals) steps back.
2. **Motion earns its place.** Every animation communicates state change — entry, acknowledgement, or mode shift. If it's decorative, it's deleted.
3. **One accent.** Coral `#d97757` (Anthropic's signature color) is used only for: send button, primary CTA, active tab, and the attention state (busy cursor, plan mode dot). Everything else is monochrome warm.

## Tokens

### Color — warm dark

```
bg.base        #19161a   app background. warm near-black, slight red tilt.
bg.raised      #22201e   sidebar, cards, top bar (with blur).
bg.surface     #2a2724   inputs, modals, command palette.
bg.hover       #332f2a   hovered rows and buttons.
bg.accent-soft #39241c   faint coral-tinted backdrop for accent chips.

border.subtle  #2f2b27   row dividers and card edges (barely visible).
border.default #3f3830   interactive element borders, focused inputs go accent.

text.primary   #f0e8d9   body. warm cream — not pure white.
text.secondary #b5a898   metadata, secondary labels.
text.muted     #7a7065   placeholders, disabled, timestamps.
text.inverse   #1a1714   on-accent text (e.g. Send button label).

accent         #d97757   Anthropic coral.
accent.hi      #e28b70   hover on accent.
accent.lo      #b85f44   pressed on accent.

success        #8aa876   muted sage. accepted diffs, connected dot.
warning        #d4a95e   warm amber. plan mode, pending decisions.
danger         #c66a4f   warm red. errors, denied actions.
```

**Rules of thumb**
- Any "hot" color is reserved. 90% of pixels sit in `bg.*` / `border.*` / `text.*` with no chroma.
- `accent` never appears more than once per screen as a large surface. It appears frequently as small chips, text color on hover, or 1px focus rings.
- Status colors (`success` / `warning` / `danger`) always appear as 1px borders + subtle tinted backgrounds (`*-soft` variants applied with 10-15% alpha over `bg.raised`), never as saturated fills.

### Typography

```
Display   ui-serif, "Iowan Old Style", Georgia, serif        — headlines only
Body      Inter, -apple-system, system-ui, sans-serif         — everything else
Mono      "JetBrains Mono", "SF Mono", ui-monospace           — code, paths, diffs
```

Display serif is used **only** in two places: the empty-state hero ("Ready when you are.") and the Plan approval modal title. Everywhere else is Inter.

Scale:
```
xs    11px / 16   — timestamps, tiny labels, keyboard chips
sm    13px / 20   — sidebar items, tool meta, most UI copy
base  15px / 24   — message body (user and assistant), input
lg    17px / 26   — subsection titles, modal headers
xl    22px / 30   — serif display hero, plan title
```

Weights: 400 (default), 500 (labels, buttons), 600 (display hero, plan title). No 700 — looks shouty in dark mode.

### Motion

Time constants:
```
--d-hover    120ms    color/opacity on pointer-over
--d-enter    180ms    popover / sidebar item reveal / toast
--d-modal    220ms    modal scale + fade in
--d-exit     140ms    anything going away (shorter than enter)
--d-mode     240ms    mode strip slide, diff border color cross-fade
```

Easings:
```
--e-out      cubic-bezier(.22, 1, .36, 1)            default for exits and hovers
--e-spring   cubic-bezier(.34, 1.56, .64, 1)          slight overshoot for modal entry
--e-soft     cubic-bezier(.4, 0, .2, 1)              standard "material" for long blocks
```

Patterns:
- **New message**: `opacity 0→1 + translateY(4px→0)`, `--d-enter --e-out`.
- **Modal enter**: backdrop `opacity 0→1 --d-enter --e-out`; panel `scale(.96→1) + opacity 0→1 --d-modal --e-spring`.
- **Modal exit**: everything `--d-exit --e-out`, no overshoot.
- **Button press**: `transform scale(.98)` on `:active`, instant.
- **Mode cycle**: `ModeDot` color cross-fade `--d-mode --e-soft`; strip below slides from `height 0 → auto` with `overflow hidden`.
- **Streaming cursor**: 1.1s `ease-in-out` infinite on a 1ch bar at the end of the active assistant text.
- **Sidebar hover reveal**: rename/delete icons fade in at `--d-hover` (no translate — pure opacity).

### Radii / shadows / spacing

```
radius.sm    6px    small chips and pills
radius.md    10px   cards, inputs
radius.lg    14px   modals, command palette
radius.xl    20px   input bar floating card

shadow.pop   0 1px 0 rgba(255,230,200,.02) inset, 0 6px 20px -8px rgba(0,0,0,.6)  — popovers
shadow.modal 0 24px 60px -16px rgba(0,0,0,.7), 0 0 0 1px var(--border-subtle) — modal panels
```

Spacing uses Tailwind's default 4px scale. Nothing custom.

## Component specs

### App shell

```
┌────────────┬────────────────────────────┐
│  Sidebar   │  TopBar  (44px, blurred)   │
│  288px     │                            │
│  bg.raised ├────────────────────────────┤
│            │                            │
│            │  MessageList               │
│            │  max-w 720px, centered     │
│            │                            │
│            ├────────────────────────────┤
│            │  InputBar (floating card)  │
└────────────┴────────────────────────────┘
```

### TopBar

Height 44px. `bg.base` with `backdrop-filter: blur(8px)` and `border-b border.subtle`. Pills are 28px tall, `radius.sm`, inactive `bg.raised`, hover `bg.hover`. Only one pill can be "active" (accent text + accent-soft bg) — normally none are.

Order: `[cwd chip] · [model chip] · [mode chip] · (spring gap) · [token count] [cost] [session title — click to rename]`

Each chip has a 14px icon + label + 10px down-chevron. Hover shows bg fade; click pops a menu. The cwd chip shows a truncated path: `~/…/projects/claude-code-web` (ellipsis middle). Full path on tooltip.

### Sidebar

288px wide, `bg.raised`, `border-r border.subtle`. Three sections stacked.

**Brand row** (56px, no border): coral ●8px dot, "claude-code-web" in `sm` `text.primary`, right-side faint `⌘K` chip.

**Actions row** (48px): "New chat" button full width, `bg.accent-soft` background, coral text, plus-icon left. Under it: a subtle search input, `sm`, `placeholder: Search history…`.

**History list** (fills): grouped by time — `TODAY`, `YESTERDAY`, `THIS WEEK`, `EARLIER` headers as `xs` uppercase `text.muted`, 10px top padding. Each item is 52px: title (`sm`, 2 line clamp, `text.primary`), meta row (`xs`, `text.muted`): `time · git-branch`. Hover: `bg.hover` + rename/delete icons fade in at right.

**Project footer** (60px, `border-t border.subtle`): small `xs text.muted` label "PROJECT" + mono path wrapped in 2 lines max.

### MessageList

Scroll container. Content max-width 720px, horizontal padding 24px, vertical 32px.

- **User message**: right-aligned. Max width 80%. `bg.accent-soft` background, `text.primary`, `radius.lg`, padding `10px 16px`. Corner pokes right-bottom (border-radius `14px 14px 4px 14px`).
- **Assistant text**: no bubble. Just plain `text.primary` prose on the base background, generous 1.6 line-height. When streaming, a `|` cursor (1ch wide, 1.2em tall, `bg.accent`) pulses at the current end.
- **Thinking**: collapsed-by-default summary with a faint `border-left` in `text.muted`. Format: `thought for 2.3s` in `xs text.muted`. Click to expand to `sm text.secondary`.
- **Tool card** (ToolUse, non-edit tools): `bg.raised` card, 1px `border.subtle`, `radius.md`. Header row: tool name in `sm text.accent` (muted accent — think `#c4896f`), one-line arg preview in mono. Body collapsed by default. Hover: border shifts to `border.default` and `transform: translateY(-1px)` over `--d-hover`.
- **Diff card** (Edit/Write/MultiEdit): same card chrome, but body always shows hunks. Each hunk renders as:
  ```
   12 │ - old line
   13 │ + new line
  ```
  line number in `xs text.muted` mono left gutter, `-` line bg `rgba(198,106,79,.08)` + `text.primary`, `+` line bg `rgba(138,168,118,.08)` + `text.primary`. No big red/green blocks. When pending, card border is `warning`; when accepted it crossfades to `success`; rejected to `danger`.
- **System note**: xs, `text.muted`, flat, one line, no card.
- **Busy**: at the tail, "Claude is thinking…" in `sm text.muted` with the same cursor.

### InputBar

A **floating** card, not a bottom bar. Sits 24px above the bottom of the main column, centered, max-width 720px, `bg.surface`, `radius.xl`, `shadow.pop`. 1px border `border.default`; focus-within → border → `accent` with a 4px `ring` in `rgba(217, 119, 87, .15)`.

Inside, stacked rows:
1. **Meta row** (top, 24px): on the left a colored dot (`ModeDot`) + mode label in `xs text.secondary` — if mode is default, this row is empty (0 height). On the right, a subtle file chip stack for pending `@file` attachments.
2. **Textarea** (middle): Inter 15px, auto-grow, placeholder cycles through example prompts every 5s.
3. **Hint row** (bottom, 22px): left `⌘K` `·` `@` `·` `/` `·` `⇧⇥ mode` as tiny `xs text.muted` chips; right a circular Send button (36px), `bg.accent` when there's text (else `bg.hover`). Stop button is the same circle but shows a stop-square instead of send-arrow, and lives in the same spot — crossfades when busy.

### Modals (Permission / Plan / CwdPicker)

Full-screen backdrop: `rgba(20, 16, 15, .65)` with `backdrop-filter: blur(6px)`, fades in at `--d-enter`. Panel is centered, `bg.surface`, `radius.lg`, `shadow.modal`, max-width 560px, padding 24px. Panel enters with `scale(.96→1) + opacity` at `--d-modal --e-spring`.

**Permission modal** — compact. Icon (20px, line), 1-line title ("Claude wants to use Bash"), sm description. Mono block showing the command. Buttons row at bottom right: Deny (ghost), Allow once (outline), Allow for session (filled `accent`). ESC = Deny. Focus trap on.

**Plan approval modal** — larger, up to 640px wide. Serif title `lg` "Plan ready". Body renders plan markdown (min support: paragraphs, lists, inline code). Top-right small `xs` chip "Plan mode · read-only". Button row: `[Reject]` `[Approve & execute]`. Approve is `accent`-filled, large. After approve, modal exits and the ModeStrip in the shell slides up and away over `--d-mode`.

**CwdPicker** — 520×480 panel, path text input at top (mono, `bg.base`), current directory dirs list below (sm, monospaced), keyboard navigable. Each row: folder icon + dir name. `..` at the top for parent.

### Command Palette (Cmd-K)

Triggered by `⌘K` / `Ctrl+K`. Identical backdrop as modals. Panel: 640×420, anchored 15% from top (not centered), `radius.lg`, `bg.surface`, `shadow.modal`.

Layout:
- **Search row** (52px): 18px search icon, input in `base` `text.primary`, placeholder "Type to search…", right-aligned `xs text.muted` "⌘K".
- **Result list** (scroll): groups (`xs` uppercase labels `text.muted` 8px vertical padding).
  - **Actions**: New chat, Clear session, Rename…, Open folder, Show history.
  - **Models**: Opus 4.7, Sonnet 4.6, Haiku 4.5.
  - **Modes**: default, auto-accept edits, plan.
  - **Sessions**: last 20 matching by summary / customTitle.

Each result row: 40px, icon (20px) + primary label (`sm text.primary`) + right-side `xs text.muted` hint (e.g. "⌘N", "switch model"). Selected row: `bg.hover`. `↑/↓` to navigate, Enter to execute, Esc to close.

### Empty state

Shown when a session is fresh with no messages. Centered on the main column.

- Serif hero (`xl` weight 600, `text.primary`): "Ready when you are."
- `sm text.secondary` one-liner: "Ask anything. I have access to this project."
- 3 example prompt cards, horizontal, `bg.raised`, `radius.md`, hover raises 1px and border goes `border.default`. Each card: two-line prompt, `sm`. Click populates the input.
- Bottom: keyboard chip row, `xs text.muted`: `⌘K command palette` · `⇧⇥ cycle mode` · `@ attach file` · `/ slash command`.

### Toasts

Top-right, stacked. Each: `bg.raised`, `border.subtle`, `radius.md`, padding 12×14, icon + message. Enter from +12px right with fade at `--d-enter`. Auto-dismiss after 4s. Errors get `border.default` → `danger` color strip on the left edge.

## Flows (annotated motion)

### Send a message
1. Textarea has text → Send button's bg crossfades from `bg.hover` to `accent` over `--d-hover`.
2. User hits Enter → user bubble appears (fade-up, `--d-enter`) at bottom of list, input clears, list scrolls by the delta with `smooth` scroll.
3. 80-400ms later, "Claude is thinking…" appears. If `includePartialMessages` fires, an assistant paragraph begins, with the pulsing cursor at the tail.
4. When a tool is proposed, a tool card fades-up. If it's an edit, the card has a warning border. When user clicks Accept, border and left gutter crossfade to success over `--d-mode`, and the Accept/Reject buttons collapse to a `+3 -1` summary.

### Plan approve
1. Plan mode is on (mode strip visible, warm amber dot + text in InputBar's meta row).
2. Claude emits ExitPlanMode → modal fades in with plan markdown, serif "Plan ready" title.
3. User clicks Approve → modal exits (scale+fade out, `--d-exit`), the ModeStrip in InputBar collapses to height 0 over `--d-mode`, the pending tool call begins executing with its card fading up.

### Mode cycle (Shift+Tab)
1. In textarea, user presses Shift+Tab.
2. `ModeDot` color crossfades (default gray → sage → amber → gray).
3. A transient toast appears at top-right: "Mode: auto-accept edits". Auto-dismisses.

### Cmd-K
1. `⌘K` pressed anywhere → backdrop fade, palette pops in with spring.
2. User types → list filters live (no debounce needed; results are small).
3. Enter executes action; palette exits with `--d-exit`. For "switch model" or similar, a toast confirms.

## Against v2

| v2 | v3 |
|---|---|
| Cold zinc grays, blue primary | Warm stones, single coral accent |
| Emoji icons (📁 🧠 ⏸) | Inline SVG (lucide-style, 1.5 stroke) |
| ModeStrip = full-width colored bar above input | ModeDot = small colored dot inside input's meta row |
| Bold red/green blocks in diffs | GitHub-style gutter + subtle row tints |
| Send button: rectangular blue | Send button: 36px coral circle, arrow icon |
| Modals appear at 100% opacity instantly | Modals scale+fade in with spring |
| Dropdowns click-through an invisible overlay | Popovers have backdrop blur and focus trap |
| No empty state | Serif hero + example prompts + keyboard chips |
| No global command palette | ⌘K opens Raycast-style palette |
| Batch-appending assistant text | Per-token streaming cursor (when backend supports) |
| `<details>` for thinking with browser default arrow | Custom "thought for 2.3s" reveal with faint left border |

## Handoff notes for implementation (Phase B)

- Add `Inter` and `JetBrains Mono` via `<link>` preconnect; load only weights actually used (400, 500, 600).
- Move all tokens into `tailwind.config.js` `theme.extend` so semantic names (`bg-base`, `text-muted`, `accent`) replace ad-hoc zinc classes everywhere.
- Migrate all existing components; no one-off colors should remain after migration.
- Add `useKeyboard()` hook for global `⌘K` and `Esc`. Add `useFocusTrap()` for modal accessibility.
- Enable `includePartialMessages: true` on the SDK `query()` call and add reducer handling for streaming assistant text.
- Keep the protocol and backend logic untouched otherwise — this is a visual + interaction overhaul, not a capability one.
