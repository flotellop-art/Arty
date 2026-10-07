# Mobile report links — 2026-10-07

## Incident and scope

The supplied conversation contains a Sonnet 5.5 answer with a report URL at
`https://localhost/report/<uuid>` marked `non vérifié`. This text alone does
not establish whether the report remains stored on the user's phone.

Two code paths explain the symptom: the fact-checker neutralizes localhost
report links lacking web provenance, and the native Markdown link handler
opens all HTTP(S) links in Capacitor Browser. Reports are encrypted resources
of the app's local storage; an external browser cannot access them.

## Correction

- Recognize only canonical, current-origin report routes with a v4 UUID.
- Preserve report links only when stored under the current account, without
  treating their factual contents as verified.
- Navigate inside React Router and revalidate account, session epoch and
  storage presence on click. Missing reports show a visible explanation.
- Add an app-owned recovery link beside an old neutralized inline URL when
  its report is still stored. Keep original message text, archives and fenced
  code unchanged and inert.
- Allow returning to chat from the missing-report page; preserve its sandbox.
- Keep public Markdown's imports and capabilities separate from private
  identity/storage through a pure context and a private authenticated provider.
  Public shares explicitly disable that context, even inside a signed-in app.
- Prepare Android 1.0.111 / versionCode 112. Firebase's latest release was
  verified as 1.0.110 / 111 before selecting the new version.

## Validation and limits

Two independent read-only reviews found no blocking issue after their
objections were incorporated. Typechecks and 91 distinct targeted tests pass
across report navigation, grounding, storage ownership, sandbox, Markdown and
archive rendering. Native link tests simulate Capacitor; no phone was attached
to ADB. Physical Android clicking and the user's stored report are unverified.

The first full CI run found one genuine public dependency-boundary regression
(6,067 tests passed, one failed, one skipped). The renderer initially imported
private session code. The revised candidate separates the pure parser/context
from the private resolver. The unchanged boundary test and new runtime tests
prove that public shares do not inherit a private resolver or read storage.

Known pre-existing issues outside this fix: report HTML already loaded in
ReportPage is not cleared by same-user crypto invalidation; HTML data-action
links and conversation-summary window opening have separate handlers.
