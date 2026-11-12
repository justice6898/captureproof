# Demonstration — reviewed v6 example

The **2:59 narrated video** follows the saved report through **Overview → Evidence → AI review → Repair → Files**. The owner reports that it is uploaded to YouTube and plays in the Devpost submission preview. Final Devpost submission has not been confirmed.

## Open the same report

Open [the included HTML report](../data/portable-reports/reviewed-v6-journey-2026-11-12/report.html) locally, or use the read-only server on the supported Mac with Node 24+:

```sh
npm run start:example -- 3100
```

Open **http://127.0.0.1:3100/examples/reviewed-v6**. This displays a saved execution; viewing, navigating and downloading do not start a campaign, replay or model request. GitHub displays the HTML source rather than running the report.

## Report walkthrough

| Section | What to inspect |
|---|---|
| Overview | At the first returned-call boundary, provider capture is PENDING while the original merchant records completed payment and one capture row. At the matching boundary, the separately authored repair retains local authorized state and zero rows. Authorized is a merchant status, not proof of money movement. |
| Evidence | Expand the checkpoints to compare provider and merchant records. Later, the provider reports completed while the original merchant still stores pending. Repeated requests alone do not establish duplicate charges. |
| AI review | Read the saved explanation and open its source citations: `retrievePayment` accepts an order ID without checking capture completion, and the host sets `captured_at` from local `isFullyCaptured`. Structural acceptance and same-development-session semantic review are separate outcomes. |
| Repair | Inspect the independently developer-authored repair, its source and matching checkpoint results. The repair predates the model response. The AI's proposed corrections and five regression controls remain unexecuted; checkpoint PASS does not establish general correctness. |
| Files | Inspect the saved original and repair replay identities, evidence and frozen-source downloads. Download the self-contained HTML to inspect it offline. These records use real Medusa, PostgreSQL and PayPal SDK execution with simulated PayPal responses. Separate genuine Sandbox observations do not make this example a live-provider test. |

The report preserves the complete selected model response, source citations, 23 embedded artifacts and 16 frozen source files. Its recorded execution and saved replays happened earlier; opening the report does not reproduce them.

## Optional executable application

The application is separate from the read-only report server:

```sh
npm run start:verification -- 3200
```

Open **http://127.0.0.1:3200/external?view=develop**, choose a supported candidate and select **Review execution plan · no execution**. This previews a proposed run. Switching to **http://127.0.0.1:3200/examples/reviewed-v6** opens the earlier frozen result, not a result for that candidate. Retain any prerequisite warning; do not bypass it.

See the [operating guide](OPERATIONS.md) before explicitly setting up dependencies or running a campaign. Files → **Use the executable application** also provides setup instructions. Missing or corrupt primary assets must not be replaced with a different diagnosis.

## Earlier walkthrough measurement

An earlier agent-operated Chrome walkthrough on the same Mac took **158.011 seconds**, including scripted reading pauses. It began with a plan preview and then switched to the saved report. That measurement is neither the duration of the 2:59 narrated video nor an independent-user usability study. Fresh-machine installation and independent-user testing remain unverified.
