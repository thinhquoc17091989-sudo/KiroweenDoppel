# Requirements: architecture review loop (thin slice)

## Introduction
A person asks Kiro to propose an architecture, reviews it as a diagram, approves it,
and gets code, tests and a trace table per element.

## Requirements

### R1 Show proposals
**User story:** As a reviewer, I want proposed elements drawn differently from approved ones, so I can see what still needs a decision.
1. WHEN a proposal file is loaded, THEN the diagram SHALL draw each proposed element with a dashed border.
2. WHEN an element is approved, THEN the diagram SHALL draw it with a solid border.

### R2 Decide on proposals
1. WHEN the reviewer accepts a proposal, THEN the system SHALL mark the element approved.
2. WHEN the reviewer renames a proposal, THEN the system SHALL keep its links and use the new name everywhere.
3. WHEN the reviewer rejects a proposal, THEN the system SHALL remove it and SHALL NOT generate code for it.

### R3 Save as text
The PlantUML subset supports `component`, `interface`, `note`, `-->` and `..>` links, and `' id:`, `' req:` and `' status:` comments.
1. WHEN the reviewer approves the architecture, THEN the system SHALL write approved elements to `architecture/*.puml`.
2. WHEN a model is printed and parsed again, THEN the parsed model SHALL equal the original model. (property-based test)
3. WHEN printed text is parsed and printed again, THEN the output SHALL equal the first printed text. (property-based test)

### R4 Generate per element
1. WHEN an element becomes approved, THEN a hook SHALL generate one code file and one test file for it.
2. WHEN generation finishes, THEN the system SHALL add or update one trace link for that element.

### R5 Trace table
1. The trace table SHALL list each element with its code file, test file and state (in sync or stale).
2. WHEN an architecture file changes after its code was generated, THEN the matching trace link SHALL become stale.

### R6 Drift check
1. WHEN the drift checker runs, THEN it SHALL report each code or test file without an element and each element without code or test.
2. The drift checker SHALL be callable by Kiro as an MCP tool, so the agent sees the result and can fix it.

## Out of scope
Real SysML, multi-user editing, any hosted backend.
