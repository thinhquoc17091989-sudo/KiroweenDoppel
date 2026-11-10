---
inclusion: always
---

# Approved architecture

The approved system architecture is in `architecture/*.puml`. Read it before you write or change code.

#[[file:architecture/*.puml]]

## Rules

- Element ids are the stable identity. Each element has a `' id:` comment, such as `' id: pump-driver`.
  Use the id to refer to an element in code, tests, comments, commit messages and `trace.json`.
  Do not rely on the display name or the alias, because the reviewer may rename them.
- Put code for an element in `src/<element-id>.ts`.
- Put tests for an element in `test/<element-id>.test.ts`.
- After you write code or a test for an element, add or update that element's row in `trace.json`.
  The row holds the element id, code path, test path, requirement ids, task number and element hash.
- Do not write code for an element that is not in `architecture/*.puml`. Proposals in `proposals.puml`
  are not approved and are not part of this architecture.
- If code or a test has no matching element, report it as drift instead of guessing a new element.
