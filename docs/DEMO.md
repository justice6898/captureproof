# Demonstration — reviewed v6 example

[Watch the 2:59 narrated video](https://youtu.be/lVA9luL7J9Y), then follow the saved report through **Overview → Evidence → AI review → Repair → Files**. The guide below connects each screen to the included evidence. See [submission notes](SUBMISSION.md) for submission status and provenance.

## Open the same report

Open [the included HTML report](../data/portable-reports/reviewed-v6-journey-2026-11-12/report.html) locally, or use the read-only server on the supported Mac with Node 24+:

```sh
npm run start:example -- 3100
```

Open **http://127.0.0.1:3100/examples/reviewed-v6**. This displays a saved execution; viewing, navigating and downloading do not start a campaign, replay or model request. GitHub displays the HTML source rather than running the report.

## Report walkthrough

| Section | What to inspect |
|---|---|
| Overview | Compare the first returned-call boundary: provider capture PENDING; original collection completed with 1 capture row; developer repair locally authorized with 0 rows. |
| Evidence | Expand the checkpoints. At the later completed observation, provider capture is COMPLETED, the original stored capture remains PENDING, and the repair stores COMPLETED. Inspect the bound provider and merchant records. |
| AI review | Read the saved explanation and open its source citations: `retrievePayment` accepts `result.id` without checking capture completion, and the host sets `captured_at` from local `isFullyCaptured`. Inspect the separate structural and semantic review outcomes. |
| Repair | Open the separately developer-authored repair, its source and matching checkpoint results. Compare the tested implementation with the model's unexecuted proposals. |
| Files | Inspect the original and repair replay identities. Download evidence, frozen source or the self-contained HTML for offline inspection. |

The report preserves the complete selected model response, 23 embedded artifacts and 16 frozen source files. These are earlier recorded executions and replays, using real Medusa, PostgreSQL and PayPal SDK with simulated PayPal responses. Separate Sandbox observations do not turn this example into a live-provider test. The repair predates the model response; the AI's proposed corrections and five regression controls remain unexecuted. Local authorized state is not proof of money movement, repeated requests alone do not establish duplicate charges, and checkpoint PASS is not general correctness.

## Optional executable application

The application is separate from the read-only report server:

```sh
npm run start:verification -- 3200
```

Open **http://127.0.0.1:3200/external?view=develop**, choose a supported candidate and select **Review execution plan · no execution**. This previews a proposed run. Switching to **http://127.0.0.1:3200/examples/reviewed-v6** opens the earlier frozen result, not a result for that candidate. Retain any prerequisite warning; do not bypass it.

See the [operating guide](OPERATIONS.md) before explicitly setting up dependencies or running a campaign. Files → **Use the executable application** also provides setup instructions. Missing or corrupt primary assets must not be replaced with a different diagnosis.

## Earlier walkthrough measurement

An earlier agent-operated Chrome walkthrough on the same Mac took **158.011 seconds**, including scripted reading pauses. It began with a plan preview and then switched to the saved report. That measurement is neither the duration of the 2:59 narrated video nor an independent-user usability study. Fresh-machine installation and independent-user testing remain unverified.
