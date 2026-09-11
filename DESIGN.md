# E2 Auto Design System

## Purpose

This file defines the visual and interaction language for E2 AUTO SDN BHD.

All AI coding agents, designers, and contributors should read this file before changing the UI.

The goal is not to copy Apple or any single reference site. The target is a distinct E2 identity built from:

- Japanese automotive editorial restraint
- Apple-style product discipline and fluid interaction
- Malaysian used-car sales clarity and conversion

The result should feel premium, calm, modern, trustworthy, and recognizably E2.

---

## Design North Star

**E2 should feel like a premium digital showroom, not a template-based used-car website.**

A visitor should feel:

1. The car is the hero.
2. The deal is understandable.
3. The interface is calm and trustworthy.
4. The next action is obvious.
5. The page does not look AI-generated.

Use restraint. Remove before adding.

---

## Core Principles

### 1. One screen, one idea

Do not stack many unrelated messages in one viewport.

Good:
- Hero screen: car + model + one value proposition
- Finance screen: one monthly affordability message
- Usage screen: work / family / balik kampung
- Conversion screen: test drive / trade-in / loan

Avoid:
- 6 feature cards under one heading
- multiple CTAs competing in the same area
- long paragraphs beside large decorative graphics

### 2. The car is the product

Photography should carry the page.

- Prefer real E2 vehicle photos.
- Do not replace real cars with AI-rendered lookalikes.
- Large car imagery should occupy 55–80% of a hero composition when appropriate.
- Crop intentionally. Favor strong front 3/4, rear 3/4, cabin, dashboard, wheel, and detail views.
- Backgrounds may be cleaned or darkened, but the vehicle should remain authentic.

### 3. Fewer cards

Cards are not the default layout.

Use cards only for:
- inventory items
- compact calculators
- temporary floating controls
- short comparison modules

Prefer direct content on the canvas for storytelling sections.

### 4. Premium through spacing, not decoration

The interface should feel premium because of rhythm, hierarchy, and photography.

Do not rely on:
- excessive gradients
- excessive glow
- stacked glass panels
- random shadows
- animated blobs
- decorative grid backgrounds

### 5. Conversion without shouting

The page should sell, but not feel desperate.

Primary actions:
- View Car
- Calculate Monthly
- WhatsApp
- Book Test Drive
- Trade In
- Apply / Check Loan

Use one primary CTA per section whenever possible.

---

## Brand Color System

### Primary canvas

Warm White
- `#F5F5F2`
- Use for major editorial and product-storytelling sections.

Paper White
- `#FCFCFA`
- Use sparingly for cleaner content surfaces.

Graphite
- `#111214`
- Main dark section background.

Deep Graphite
- `#08090B`
- Hero overlays, modal backgrounds, premium dark scenes.

### E2 accents

E2 Gold
- `#D9B65B`
- Secondary premium accent only.
- Use for small highlights, labels, trim, premium status, or selected values.
- Never use as a large page background.

E2 Red
- `#E53935`
- Conversion / urgency accent.
- Use for one key CTA, status dot, stock urgency, or selected controls.
- Do not combine red and gold everywhere.

### Text

Primary on light
- `#111214`

Secondary on light
- `#6B6F76`

Primary on dark
- `#F7F7F5`

Secondary on dark
- `#A8ADB5`

### Color ratio guideline

Approximate target:
- 65–75% neutral white / graphite
- 15–25% vehicle photography
- 5–8% gold accents
- 2–4% red accents

The brand should not look like a black-and-gold casino theme.

---

## Typography

Use the platform system stack first:

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
```

### Display type

- Very large where the message deserves it.
- Tight line height.
- Negative letter spacing.
- Short phrases only.

Recommended:

```css
font-size: clamp(4rem, 10vw, 9rem);
line-height: 0.88;
letter-spacing: -0.065em;
font-weight: 750;
```

### Section headings

```css
font-size: clamp(2.75rem, 5vw, 5.25rem);
line-height: 0.95;
letter-spacing: -0.045em;
font-weight: 700;
```

### Body

```css
font-size: 1rem to 1.2rem;
line-height: 1.55 to 1.7;
letter-spacing: 0;
```

### Small labels

- 11–13px
- slight positive tracking
- uppercase only for very short metadata

Do not use uppercase for long labels or paragraphs.

---

## Copy Style

### Sales tone

Clear, simple, confident.

Prefer:
- `From RM22,990`
- `Estimated from RM400++ / month`
- `See the actual unit before you decide.`
- `Trade in your current car.`
- `Loan applications can be tried where eligible.`

Avoid:
- exaggerated guarantees
- fake urgency
- dense banking language on the hero
- all-caps paragraphs

### Financing safety

Never imply guaranteed loan approval.

Approved phrasing patterns:
- `Subject to approval.`
- `Applications can be tried where eligible.`
- `CTOS / CCRIS / AKPK cases are assessed case by case.`
- `Final rate and monthly payment depend on the bank / financier and applicant profile.`

Avoid:
- `100% approve`
- `confirm lulus`
- `guaranteed full loan`

---

## Layout Rhythm

### Page width

```css
max-width: 1180px to 1280px;
```

### Section spacing

Desktop:
- 96–160px vertical spacing between major sections

Mobile:
- 64–96px

### Content density

Aim for low density.

If a section has:
- a large heading
- a paragraph
- three cards
- two CTAs
- a badge
- a decorative graphic

…it is probably too busy.

---

## Radius System

Use only these values unless there is a strong reason:

- `16px` — compact controls / small cards
- `24px` — standard card / media container
- `32px` — major hero / feature container
- `999px` — pills

Avoid random radius values like 18, 22, 26, 28, 30 in the same page.

---

## Glass / Material Rules

Glass is functional, not decorative.

Allowed:
- floating navbar
- sticky action bar
- modal / sheet
- selected product info overlay

Avoid:
- glass on every card
- nested translucent panels
- large text areas sitting on busy blur

Recommended light glass:

```css
background: rgba(255,255,255,.68);
backdrop-filter: blur(20px) saturate(160%);
border: 1px solid rgba(255,255,255,.55);
```

Recommended dark glass:

```css
background: rgba(15,16,19,.60);
backdrop-filter: blur(22px) saturate(150%);
border: 1px solid rgba(255,255,255,.10);
```

Larger surfaces may use stronger blur and deeper separation.

---

## Motion System

Follow `.agents/skills/apple-design/SKILL.md` for interaction behavior.

### Core rules

- Feedback begins on pointer-down.
- Touch / pointer motion should feel direct.
- Interactive motion should be interruptible.
- Prefer spring behavior for touch-driven elements.
- Preserve velocity when a gesture releases.
- Use `transform` and `opacity` for frame-critical animation.
- Do not animate layout height during scroll.

### Default press response

```css
.pressable {
  transform: scale(1);
  transition: transform 100ms cubic-bezier(.23,1,.32,1);
}

.pressable:active {
  transform: scale(.97);
}
```

### Scroll storytelling

Use scroll motion only when it helps explain the product.

Good examples:
- car image subtly scales while entering the hero
- crop moves from full car to detail
- text cross-fades while the car remains anchored
- pricing bar appears when the user reaches purchase intent

Avoid:
- every section sliding in
- constant parallax everywhere
- looping motion with no purpose

### Reduced motion

Always support:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    scroll-behavior: auto !important;
  }
}
```

Replace strong travel / parallax with short opacity transitions.

Also support reduced transparency and higher contrast when relevant.

---

## Hero Design

The hero should feel like a launch page, not a classifieds listing.

Preferred structure:

1. E2 / model label
2. 1 large statement
3. 1 short supporting sentence
4. 1 primary action
5. Car photography
6. Price or monthly figure as secondary information

Example:

```text
MYVI.
Made for real life.

From RM22,990
Estimated from RM400++ / month

[Calculate monthly]
```

Do not put a full feature list in the hero.

---

## Inventory Cards

Inventory cards should feel editorial rather than marketplace-heavy.

Each card should contain at most:
- vehicle photo
- model + year / variant
- price
- monthly estimate if useful
- one short status label

Do not display 8 specs on the card.

Specs belong on the detail page.

Use horizontal browsing on mobile where appropriate.

---

## Car Detail Page

Every vehicle in live inventory should have its own dedicated detail page.

Recommended order:

1. Large hero / gallery
2. Model, year, variant, price
3. Sticky action bar
4. Short key specs
5. Condition / ownership story
6. Interior / exterior details
7. Finance estimate
8. Trade-in
9. Loan support
10. Showroom / WhatsApp conversion

### Required vehicle identity data

Every live vehicle detail page should include these fields when available:

- Plate number / registration number
- Year
- Make + model
- Variant / engine
- Transmission / drivetrain
- Mileage
- Selling price
- Exterior colour
- Showroom / location
- Stock status

**Plate number is a required identity field for E2 listings.** Show it clearly in the key-spec area, near year / variant / mileage. Do not hide it inside long body copy.

When a customer taps WhatsApp from a vehicle page, include the plate number in the pre-filled enquiry so the E2 team can identify the exact unit immediately.

Do not use the plate number as the permanent page URL because registration numbers can change or be transferred. Prefer a stable model / inventory slug or stock ID for the URL.

### Sticky purchase bar

Can include:
- price
- monthly estimate
- WhatsApp
- test drive

Keep it simple.

---

## Loan Calculator

The calculator is a decision tool, not a banking dashboard.

Preferred inputs:
- Car price
- Deposit
- Trade-in value
- Flat rate
- Tenure
- Applicant profile

Output hierarchy:

1. Estimated monthly payment
2. Estimated loan amount
3. Tenure + rate
4. Disclaimer
5. WhatsApp handoff

Do not visually over-emphasize every input.

---

## Mobile Rules

Mobile is a first-class layout.

- Keep primary CTA within thumb reach when possible.
- Use minimum 44px hit targets.
- Avoid tiny icon-only actions.
- Collapse secondary navigation.
- Do not let hero text cover the most important part of the vehicle.
- Avoid horizontal scroll unless it is intentionally a gallery or inventory rail.
- Sticky bars should not consume too much vertical space.

---

## Anti-AI-Look Checklist

Before shipping a page, check:

- Are there too many rounded cards?
- Are there too many gradients?
- Are glass effects used everywhere?
- Are section headings all the same size and rhythm?
- Is every section centered for no reason?
- Is the page full of generic phrases like `Elevate your journey`?
- Are icons decorative rather than functional?
- Are there 3-column feature cards because AI defaulted to them?
- Is there enough photography and whitespace?
- Does this page clearly feel like E2 Auto?

If it feels like a generic SaaS template, redesign it.

---

## Reference Resources

Use these as inspiration and component / system references, not as sources to copy literally:

- 21st — community UI components: `https://21st.dev/`
- Recent — design inspiration: `https://recent.design/`
- Refero Styles — DESIGN.md references for AI agents: `https://styles.refero.design/`
- Minimal Gallery — minimal website references: `https://minimal.gallery/`
- MotionSites — hero / motion prompt references: `https://motionsites.ai/`
- Installed Apple Design skill: `.agents/skills/apple-design/SKILL.md`

### How to use references

1. Choose a reference for one specific purpose.
2. Extract the underlying rule.
3. Translate it into E2's visual system.
4. Do not copy logos, proprietary artwork, copywriting, or exact layouts.

**Copy the system, not the site.**

---

## Current E2 Brand / Product Context

- Company: E2 AUTO SDN BHD
- Category: Used cars
- Primary market: Malaysia
- Main conversion channel: WhatsApp
- Current WhatsApp: `012-278 5126`
- Current flagship demo: Perodua Myvi
- Current demo price: `From RM22,990`
- Current monthly teaser: `Estimated from RM400++ / month`
- Real showroom experience should remain part of the trust story.

---

## V5 Direction

The next site generation should follow this hierarchy:

### 1. Product-led hero
- warm white or graphite canvas
- oversized vehicle photography
- minimal copy
- one CTA

### 2. Sticky product storytelling
- one vehicle remains visually anchored
- text chapters change around it
- use real-life Malaysian use cases

### 3. Editorial inventory rail
- real vehicle photography
- minimal metadata
- large visual hierarchy

### 4. Car detail experience
- gallery-first
- sticky price/action bar
- key specs only
- include plate number as a standard identity field

### 5. Finance conversion
- calculator
- trade-in
- loan profile
- WhatsApp handoff

V5 should feel more like an automotive product launch and less like a conventional dealership homepage.
