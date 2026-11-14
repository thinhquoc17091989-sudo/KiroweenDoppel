---
inclusion: always
---

# Approved architecture

The approved system architecture lives in `architecture/`. Read it before you write or
change any code.

#[[folder:architecture]]

## Rules

- **Element ids are the identity.** Each element carries an `' id:` comment, such as
  `' id: pump-driver`. Refer to an element by its id in code, tests, comments, commit
  messages and `trace.json`. Never rely on the display name or the alias: a reviewer may
  rename either, and the id deliberately does not change when they do.
- **Code for an element goes in `src/<element-id>.ts`**, its test in
  `test/<element-id>.test.ts`. An interface element gets no test file.
- **Record generated code by running the script, never by editing `trace.json` yourself:**

      node mcp/update-trace.mjs <element-id>

  The row's hash must come from that script. A hand-written hash will not match the one the
  drift checker computes, and every element you touch will then report as stale forever —
  worse than having no row at all.
- **Check your work with the `check_drift` MCP tool** (server `doppel-drift`). It reports
  elements with no code, elements whose code is stale, and trace rows whose element is gone.
  `node mcp/check-drift.mjs` runs the same check from the command line if the tool is not
  available.
- **Only approved elements get code.** Anything in a proposals file is awaiting a reviewer's
  decision and is not part of this architecture. Do not generate code for it, and do not
  treat it as settled design, even if you can see the file.
- **If code or a test has no matching element, report it as drift** rather than inventing an
  element to justify it.

## Note on the folder reference above

`#[[folder:architecture]]` pulls in everything in that folder, which is the intent: every
approved `.puml` file, however many there are. It also pulls in `layout.json` (diagram
positions), which is harmless noise — positions are not architecture and can be ignored.
A proposals file must never be placed in this folder, precisely because this reference
cannot exclude it and it would then be presented to you as approved.
