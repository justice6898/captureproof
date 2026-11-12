# CaptureProof — submission notes

A successful checkout API call does not establish completed payment. CaptureProof helps developers find where a PayPal integration's records diverge from provider observations, explain the responsible code path, and compare a repair against the same checkpoints.

The working application combines PayPal integration, Medusa execution, PostgreSQL persistence, deterministic payment-state checks and source-linked OpenAI explanations. Its portable report connects those findings to frozen source, recorded observations and replay artifacts, so a reviewer can follow the result from payment state to code.

## What the recorded comparison shows

The featured example runs Medusa 2.7.0, PostgreSQL and PayPal Server SDK 1.0.0 with **simulated PayPal responses**. It compares the original integration with a separately developer-authored and tested repair:

| Checkpoint | Provider capture | Original merchant | Developer repair |
|---|---|---|---|
| First returned call | PENDING | Collection completed; 1 active capture row | Local authorized state; 0 capture rows |
| Later completed observation | COMPLETED | Stored capture still PENDING | Stored capture COMPLETED |

The first mismatch is premature completion. The later mismatch shows that local completion can also hide stale provider state. Deterministic rules establish these findings from bound order, capture, amount, currency and persisted records. The report keeps original and repair checkpoints, source identities and saved replay outcomes separately inspectable.

## How AI contributes

CaptureProof uses the OpenAI API to explain a recorded failure against the supplied evidence and source. In this example, the saved response connects `retrievePayment` accepting `result.id` without confirming capture completion to the host deriving `captured_at` from local `isFullyCaptured`. Citations open the relevant frozen code beside the explanation.

The application supports diagnosis generation for a bound execution through explicit input and cost review, one-request authorization, structural validation and persisted results. The model proposes corrections and regression checks; it neither owns the financial verdict nor applies patches. The tested repair shown here predates the model response.

## Inspect the demonstration

[Watch the 2:59 demonstration](https://youtu.be/lVA9luL7J9Y), then use the [viewing guide](DEMO.md) to follow **Overview → Evidence → AI review → Repair → Files**.

Open [the included report](../data/portable-reports/reviewed-v6-journey-2026-11-12/report.html) locally without credentials, dependencies or a database. Files provides the evidence and frozen-source downloads; the complete report works offline. Historical reports remain available. The [public source](https://github.com/justice6898/captureproof) and `source-bundle.json` identify the packaged files and hashes. Start with the [README](../README.md), then use [OPERATIONS.md](OPERATIONS.md) for supported application setup, candidate registration, execution, export and separately authorized services.

## Verification and provenance

The selected response is a genuine saved `gpt-6.1-sol` generation using medium reasoning, default processing and the `external-diagnosis-6` contract. It passed structural validation; a separate same-development-session semantic review returned PASS over 46 prose fields. Five proposed regression-control kinds are structurally complete. **The AI-proposed corrections and tests were not executed.** The model did not create or verify the earlier developer repair.

The featured execution uses simulated provider responses. Separate genuine PayPal Sandbox normal-capture and application-response-discard recovery were observed during development; they do not establish live-provider verification for this example or demonstrate an actual network outage. Authorized is a local merchant state, not proof of PayPal authorization or money movement. Checkpoint PASS and this one reviewed diagnosis do not establish general payment correctness, model accuracy or production safety. Checks used the same supported Mac, not a fresh-machine installation, independent-user study or blind evaluation. No hosted application deployment is claimed.

Codex assisted implementation, documentation and local verification. This development assistance is separate from the product's OpenAI API capability and its saved diagnosis. Private databases, credentials and unrelated execution records are excluded from the public package.

## Submission and license

The owner reported successful video playback in the Devpost preview. Final Devpost submission remains **unconfirmed**; the owner must complete it by the stated November 12, 2026, 3:00 PM America/New_York deadline. Preview playback does not establish submission, eligibility or acceptance.

MIT, Copyright (c) 2026 Jeongui Hong. [Third-party notices](../LICENSES.md) are preserved.
