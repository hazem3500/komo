# Design sources

The landing page adapts the compact cards, quiet typography, spacing, and neutral surfaces of `src/tools.css` in tjcages/offbr. Documentation navigation and copy controls adapt `src/skills.css` and `src/detail-sheet.css`. These sources are used at the user's request.

Interface glyphs are Untitled UI icons. The walkthrough cursor uses Untitled UI’s Cursor02 geometry with a filled pointer, white edge, and compact name tag, visually referenced from [Figma’s official multiplayer demonstration](https://www.figma.com/blog/talk-it-out-in-figma-and-figjam/). It is not an extracted Figma asset. The Palette app mark reuses the comment indicator's rounded bubble shape. The Cloudflare Workers screenshot was captured from the original Cloudflare marketing website with the review overlay disabled, then encoded as WebP.

The agent walkthrough is a scripted illustration with pause, replay, and selectable threads. It does not run agents or alter the pictured website. The actual Palette widget is installed on the surrounding site and stores shared visitor feedback in the dedicated hosted service. Automatic per-reviewer deletion in the `komo-landing-demo` project is temporarily disabled during testing. Guest identities persist in the browser; a new guest identity starts a separate history.
