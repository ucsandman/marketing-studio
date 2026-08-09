# Direction brief

No house style. Every brand gets its own look, not the same five-act template with new
colors. Fill this out BEFORE storyboarding or building any composition.

Write **three** directions, one page each, deliberately different. Then kill two using the
kill questions below. The survivor + its signature move go into
`out/<brand>/marketing/direction.md`.

## Direction template (copy this block three times)

```
DIRECTION <name>
Thesis          one sentence: what this film IS
Dials           energy / density / ground / depth / camera / type / texture /
                colour / product-literalness / sound / voice — a position on each,
                see the dial table below
Palette note    ground, ink, accent — one accent only, state the hex or brand token
Type            family + the role it plays (gets out of the way, or carries the voice)
Signature move  the one thing only this film does, tied to the product's core verb,
                repeated 2-3 times (early / payoff / resolve)
Sound           the palette, and whether music leads or narration leads
Risk            how this fails if executed at 70% instead of 100%
Wrong for       the kind of product/brand this direction would be wrong for
```

### The 11 dials

| Dial | ← one pole | other pole → |
|---|---|---|
| Energy | contemplative, long holds | relentless, cut on every beat |
| Density | one idea per frame, vast negative space | layered, many things true at once |
| Ground | void / flat paper | photographic, material, or a live field |
| Depth | resolutely flat 2D | deep 3D with real perspective |
| Camera | locked off, cuts do the work | continuous move across the whole film |
| Type | neutral grotesk, gets out of the way | editorial serif, mono, or expressive display |
| Texture | clinical, zero grain | film grain, halation, CRT, glitch |
| Colour | monochrome plus one signal | duotone, or the full brand spectrum |
| Product-literalness | reconstructed UI, literal | abstracted, metaphorical, or absent |
| Sound | silence and UI ticks | score-led, or sound-design-led |
| Voice | narrated throughout | title cards only, no voice at all |

Pick a position on each dial before opening an editor. Extremes read as a point of view;
the middle of every dial is the default look every other tool produces.

## The four kill questions

Judge each of the three directions against all four. A direction that fails any one gets
killed.

1. Does it serve the claim, or decorate it?
2. Does it look like this brand, but better than the brand currently looks?
3. Could a competitor ship this direction unchanged? If yes, kill it — it is a category
   template, not a direction.
4. Can it survive a bad day? A direction that only works if every frame is perfect is a
   direction you will abandon at 2am.

Kill two. Write the survivor into `out/<brand>/marketing/direction.md` along with its
signature move. Then stop being creative — execute the chosen direction with total
consistency.

## The >= 4-dials-different rule

Before committing, compare the survivor's dial positions against the **previous film's**
dial positions (last brand, or this brand's last version).

- Count how many of the 11 dials differ.
- **Fewer than 4 differences = a variant, not a new direction.** Go back and pick a
  different survivor, or rewrite one of the three.

## Two-ground register map

Exactly two visual grounds, never more:

| Register | Used for |
|---|---|
| Argument ground | thesis, claim, kinetic type, the "why" |
| Product-evidence ground | reconstructed UI, demo, proof, the "what" |

Every flip between the two grounds is a story turn and carries a transition (never a hard
cut with no motion connecting them). Name which ground opens the film and which one the
film ends on — that choice is part of the direction, not an accident of build order.

## Written accent budget

State the accent color(s) and exactly what they are allowed to touch. One accent, applied
to a short, named list:

```
ACCENT BUDGET
Accent color(s):  <hex or brand token>
Applies to:       emphasis word · stat numerals · active step · state flips · CTA
Does NOT apply to: <everything else>
```

A third hue anywhere in the film is a mistake — fix the budget or fix the shot, not both at
once.

## Anti-sameness checklist

Run before building. Every answer should be a real answer, not "no" by default.

- [ ] Did you inherit a direction from a previous brand's brief with new hex values? Name
      which one. Then kill it and write a third.
- [ ] Are you reaching for purple-to-orange, glass borders, or a gradient-mesh ground by
      default? That is the reference kit, not a derived choice.
- [ ] Is your opening shot kinetic type on a dark ground? That is the most common default
      in the medium — right for this claim, or just familiar?
- [ ] Would this direction work unchanged for this brand's closest competitor? If yes, it
      is a category template — kill it.
- [ ] Can you say the signature move in one sentence? If not, you do not have one.
- [ ] How many dials differ from the last film made in this repo? Fewer than 4 means a
      variant, not a direction.
- [ ] Did you write three directions, or one? One is not a choice.
- [ ] Structural check — does the arc, the climax mechanic, and the ending match the last
      film? (problem->solve at 40%, drain-to-lockup ending, one hero element swallowing
      the frame are the defaults everyone reaches for.) If all three match, it is a
      variant regardless of dial count.
