# CaptureProof — submission notes

## Product and engineering

CaptureProof helps developers debug supported PayPal checkout integrations by comparing provider payment evidence with merchant persistence, linking inconsistencies to source code, and packaging the findings in portable reports. Deterministic rules establish payment-state findings. The OpenAI API supplies source-linked explanations and proposed checks; it does not change payment state or apply patches.

The featured example uses actual Medusa 2.7.0, PostgreSQL and PayPal Server SDK 1.0.0 execution with simulated PayPal responses. At the first returned-call boundary, the provider capture is PENDING while the original merchant records completed payment and one capture row. A separately developer-authored repair retains local authorized state and zero rows at that same boundary, then completes after later completed evidence. Authorized is a local merchant status, not proof of PayPal authorization or money movement. Original and repair replay records bind the exact source, artifact and scenario.

The saved explanation identifies the causal path: `retrievePayment` accepts an order ID without checking capture completion, while the host derives `captured_at` from local `isFullyCaptured`. Source citations and the complete unchanged response make this explanation inspectable. The application also supports separately authorized diagnosis generation for a bound execution, with input review, validation, persistence and one-request cost controls; see [operations](OPERATIONS.md).

## AI evidence and development attribution

The selected `external-diagnosis-6` response is a genuine saved `gpt-6.1-sol` generation with medium reasoning and default processing. It passed structural validation. A separate same-development-session semantic review returned PASS over 46 prose fields; five proposed regression-control kinds are structurally complete. This is one reviewed case, not blind review or general model accuracy. **AI-proposed corrections and tests were not executed.** The displayed repair was independently developer-authored before that response; the model did not create or verify it.

Codex assisted implementation, documentation and local verification. This development assistance is separate from the product's OpenAI API integration and the selected saved diagnosis. No independent-human usability study is claimed.

Separate genuine PayPal Sandbox normal-capture and application-response-discard recovery were observed during development. Those observations do not turn the featured simulated-provider example into a live Sandbox test or demonstrate an actual network outage. Checkpoint-specific PASS does not establish production safety.

## Published materials and submission status

- **Source:** [justice6898/captureproof](https://github.com/justice6898/captureproof). `source-bundle.json` lists the exact packaged files and hashes. The [README](../README.md) provides report viewing and application entry points; the [operating guide](OPERATIONS.md) covers supported setup and execution.
- **Report:** [the included reviewed v6 example](../data/portable-reports/reviewed-v6-journey-2026-11-12/report.html) opens locally without credentials, dependencies or a database. It retains the selected response, review, source citations, separately tested repair and saved replay evidence. Historical reports remain available.
- **Video:** the owner reports uploading the **2:59 narrated demonstration** to YouTube and confirming playback in the Devpost submission preview. Its report walkthrough is documented in [DEMO.md](DEMO.md). This status is owner-reported; the earlier automated walkthrough measurement is a separate record.
- **Final submission:** Devpost submission has **not been confirmed**. The owner must complete it by the stated November 12, 2026, 3:00 PM America/New_York deadline. Public source and preview playback do not establish final submission, eligibility or acceptance.
- **License:** MIT, Copyright (c) 2026 Jeongui Hong. [Third-party notices](../LICENSES.md) are preserved.

The application has been checked on the same supported Mac. Fresh-machine installation, independent-user validation and a hosted application deployment are not claimed. Private databases, credentials and unrelated execution records are excluded from the public package.
