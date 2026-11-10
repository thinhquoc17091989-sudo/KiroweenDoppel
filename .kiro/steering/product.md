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
