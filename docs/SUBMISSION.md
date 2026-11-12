# CaptureProof — submission draft and readiness

## Product description

For developers debugging supported checkout integrations, CaptureProof is a narrow integration debugger that compares provider payment evidence with merchant persistence and explains inconsistencies using bound code and observations. A deterministic rule engine owns the financial finding. A real stored OpenAI explanation supplies a cited causal path and proposed checks; it never changes payment state or applies arbitrary patches.

The primary recorded example shows a PENDING capture while an upstream merchant integration records completion and one capture row. The separately developer-authored repair retains local authorized state and zero rows at that same boundary, then completes after later completed evidence. Its original and repair replay records bind exact source, artifact and scenario. “Authorized” is a local merchant status, not proof of actual PayPal authorization.

This example uses actual Medusa 2.7.0, PostgreSQL and PayPal Server SDK 1.0.0 with simulated PayPal. Separate genuine PayPal Sandbox normal-capture and application-response-discard recovery evidence exists in development; that does not turn this upstream example into a live Sandbox test or actual network-outage experiment.

The stored causal excerpt explains why the mismatch occurs: retrievePayment accepts an order ID without checking capture completion, while the host derives captured_at from local isFullyCaptured. Source citations and the complete unchanged response make that explanation inspectable. Rule checks, not AI, establish the financial finding.

The matching external-diagnosis-6 response was generated once by gpt-6.1-sol with medium reasoning/default processing. It completed and passed structural validation. Same-development-session semantic review covered 46 prose fields with PASS; five proposed control kinds are structurally complete. This is not blind review, general model accuracy, production safety or proof that AI authored/verified the earlier developer repair. Proposed corrections and tests remain unexecuted. Codex assisted implementation and local verification; no independent-human usability study is claimed.


Measured current route: **158.011 seconds**, using agent-operated Chrome with scripted reading pauses on the same Mac. This is not a narrated video, independent-human timing or fresh installation. One read-only plan preview; no campaign, model or PayPal request. Server-stopped offline verification is recorded separately.

## Current readiness

| Deliverable | Actual state | Remaining action |
|---|---|---|
| Public source | https://github.com/justice6898/captureproof; exact packaged files are listed in source-bundle.json. | Use the published commit and manifest for recording. |
| License | MIT, Copyright (c) 2026 Jeongui Hong; third-party notices retained. | Preserve notices in the exact publication. |
| Runnable application | README includes supported macOS Apple Silicon/Node 24+ setup, explicit candidate import/plan/campaign and export/replay commands. Static viewing is only part of the product. | Fresh-machine installation and independent judge access remain unverified. Current preparation installs nothing and executes no integrations. |
| Primary recorded report | Exact v6 response, source citations, same-session review, separate developer repair and saved replay evidence. Browser/offline viewing requires no private DB. | Use the matching report and manifest; preserve its evidence bindings. |
| Video | DEMO.md includes candidate selection and a read-only execution-plan preview, followed by explicitly separate recorded evidence. | Actual recording, measured duration, upload and public URL remain outstanding. |
| Deployment / submission | Neither performed. No hosted demo or submission URL is claimed. | Owner supplies final URLs and completes entry after checking current event requirements and eligibility. |

This local preparation does not assert current contest eligibility or final acceptance. Before submitting, recheck the official event page and rules; historical deadline/readiness notes are not a current legal or eligibility determination. No new payment, model generation, replay, paid reservation, deployment or submission is scheduled here.

The primary path is `data/portable-reports/reviewed-v6-journey-2026-11-12/report.html`, also served by `npm run start:example -- 3100` at `/external` and `/examples/reviewed-v6`. The two historical report/manifest pairs are immutable and explicitly accessible. Public contents exclude private databases, credentials, raw provider routing IDs, unrelated attempts and execution ledgers. The complete packaged inventory and hashes are in `source-bundle.json`.
