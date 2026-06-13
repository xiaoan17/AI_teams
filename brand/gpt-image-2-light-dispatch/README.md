# GPT Image 2 Light Dispatch Concepts

Generated with direct URL calls to the configured OpenAI-compatible endpoint:

- `POST /v1/images/generations`
- model: `gpt-image-2`
- size: `1024x1024`
- quality: `medium`

The direction follows the bright `Dispatch Core` idea from `brand/light-logo-direction`:

- bright porcelain/light-gray surfaces
- command dispatch layer, not AI cliche
- one human command routed to multiple local agents
- route blue, ink blue, and tiny amber cursor accent

## Files

| File | Notes |
| --- | --- |
| `images/01-refined-light-app-icon.png` | Cleanest app icon, but still reads a little like a route/share icon. |
| `images/02-light-brand-board.png` | Best identity-board presentation; symbol unfortunately drifts toward a person-like form. |
| `images/03-minimal-symbol-specimen.png` | Strongest brand-symbol feel; needs refinement to avoid leaf/propeller associations. |
| `images/04-router-aperture-refined.png` | More product-concept accurate, but right side reads too much like an arrow/send mark. |
| `images/05-porcelain-brand-token.png` | Best product fit: light control-surface / dispatch-layer language; still a bit hardware/circuit-like. |
| `images/direct-url-probe.png` | First connectivity probe, not recommended as design direction. |

## Recommendation

Continue with a hybrid of:

1. `03-minimal-symbol-specimen` for stronger ownable silhouette.
2. `05-porcelain-brand-token` for product accuracy and light control-surface feel.

Next prompt should ask for:

- fewer node circles
- no arrowheads
- less circuit-board language
- stronger central command aperture
- three routed lanes as negative-space cuts
- flatter vector-ready geometry

## Why Direct URL

The wrapper path returned transient `model_not_found` errors for this endpoint, while direct requests to:

`http://211.23.3.237:27544/v1/images/generations`

successfully generated images.
