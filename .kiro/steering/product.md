# Doppel: product steering

Doppel lets people review an AI-proposed architecture as a diagram, approve it,
and keep it as text in git. Code and tests are generated per architecture element.

## Vocabulary (use these words exactly)
- **Element**: one component or interface in an architecture file.
- **Proposal**: an element suggested by Kiro, not yet approved. Drawn dashed.
- **Approved**: an element a person accepted. Drawn solid. Written to `architecture/*.puml`.
- **Trace link**: a row in `trace.json` joining an element to its code file and test file.
- **Stale**: a trace link whose element changed after its code or test was generated.
- **Drift**: code or tests that exist without an element, or the reverse.

## Rules
- People review architecture and acceptance criteria. AI writes the code.
- All sample data is invented and generic (a plant-watering controller). No employer or real system data, ever.
- Never claim SysML support. Say "SysML-style" unless real SysML is implemented.
- The demo must run with no paid credits and no network.

## Origin rule
Doppel is a clean implementation. No code is copied from any other tool, employer or private. Ideas may be borrowed and are credited in the design document as ideas only.

## Architecture first, without being asked
When someone describes a new requirement, feature or change to this system, **propose the
architecture before writing any code**, even if they never mention architecture. They should
not have to ask for it: asking for a feature IS asking for the design of that feature.

1. Work out which elements the change needs: new ones, and existing ones that must change.
2. Write them into the proposals file (`proposals.puml` at the project root, or whichever
   proposals file the project already uses) as PROPOSED, never straight into `architecture/`.
   A new element gets `' status: proposed`; an approved element you are changing gets
   `' status: modified`. Keep each element's `' id:` stable.
3. Say in one or two lines what you proposed and why, then **stop and let the reviewer
   decide**. Do not generate code for a proposed element.

The reviewer approves in Doppel, which writes `architecture/*.puml`, and the hook then
generates the code. That is the whole point: a person agrees to the design before any code
exists, and nothing is built from a design nobody looked at.

Only skip this and go straight to code when the change touches no element at all — a typo,
a comment, a test tweak, a config value.
