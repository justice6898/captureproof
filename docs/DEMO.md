# Developer demonstration — reviewed v6 example

Target: **2:38**, including navigation and reading pauses. The route below uses the executable application's plan preview, then explicitly switches to a separately saved result. It does not execute a candidate. This is a recording script, not a narrated/uploaded video or independent-human usability study. Public source: https://github.com/justice6898/captureproof.


Measured current route: **158.011 seconds**, using agent-operated Chrome with scripted reading pauses on the same Mac. This is not a narrated video, independent-human timing or fresh installation. One read-only plan preview; no campaign, model or PayPal request. Server-stopped offline verification is recorded separately.

## Preparation

Use the repository checkout on the supported Mac with Node 24+. Start `npm run start:verification -- 3200` and open **http://127.0.0.1:3200/external?view=develop**. Start no campaign, install nothing and configure no credentials for this recording. Choose the built-in revision 3 candidate and use **Review execution plan · no execution**. If execution prerequisites are missing, retain the honest readiness message; plan inspection and bundled viewing remain available.

Keep **http://127.0.0.1:3200/examples/reviewed-v6** ready as the separate recorded-result tab. Download its self-contained HTML at **http://127.0.0.1:3200/examples/reviewed-v6/download** for the offline ending. Use a 1440×900 browser window. `npm run start:example -- 3100` remains the simpler read-only report server, but does not replace the executable candidate workflow.

## Route and English narration

| Time | Screen/action | Narration |
|---|---|---|
| 0:00–0:18 | Verify my change: select revision 3; Review execution plan | “When checkout records disagree, developers need to know where completion was inferred. CaptureProof lets us select a supported integration change and inspect its bounded test plan. This is only a preview; I am not running it.” |
| 0:18–0:42 | Switch explicitly to `/examples/reviewed-v6`; Overview | “Now I am opening an earlier frozen comparison, not a result from that preview. The original records completed payment and one capture row while the provider is pending. The separately authored repair retains a local authorized state and zero rows at that same boundary. Authorized does not prove money movement.” |
| 0:42–1:02 | Evidence; expand checkpoint 2 | “Deterministic rules establish the failure. Later the provider reports completed, but the original merchant still stores pending. That binding failure is different from the initial premature completion. Repeated requests do not by themselves prove duplicate charges.” |
| 1:02–1:34 | AI review; read causal excerpt, open source citation, return to review statuses | “The real stored AI response explains the code path: retrievePayment accepts an order ID without checking capture completion, and the host sets captured_at from its local isFullyCaptured value. These citations open the supplied source. Structural acceptance and same-development-session semantic review are separate; this is one reviewed case, not general AI accuracy.” |
| 1:34–1:56 | Repair; expand first component and source | “This tested repair was authored independently before the response. AI did not apply it. Its checkpoint passes are scoped to these observations; the AI's proposed correction and five controls remain unexecuted.” |
| 1:56–2:18 | Files; expand saved replays; download evidence, reproducer and report | “The evidence and frozen source travel with the report. Original and repair replays have their own saved identities. Medusa, PostgreSQL and the SDK were real here; PayPal was simulated. Separate Sandbox checkout observations do not turn this example into live PayPal proof.” |
| 2:18–2:38 | Open downloaded HTML with browser offline; inspect AI excerpt | “This file stays readable without a server. A developer can inspect the causal explanation, source and reproducible evidence, then use the supported application to test their own change explicitly. Viewing or downloading starts nothing.” |

Pause on the comparison and source citation. Do not narrate IDs or JSON; keep them inspectable. Files → **Use the executable application** gives local setup instructions without assuming a running localhost service. No new candidate inherits this stored diagnosis, finding or replay result.

## Recording and submission

Use the published source and its source-bundle.json to identify the recording workspace. Record the route and measure the actual narrated video (under three minutes). Check the recording for private tabs/credentials, upload it, verify public playback, and supply final repository/video URLs in the submission. The measured walkthrough is not a recorded or uploaded video. Recheck the official submission requirements before submitting; passing local tests is not a competition outcome or production guarantee.

Missing/corrupt primary assets must be restored from the matching candidate, not replaced with another diagnosis. Fresh-machine installation, independent-user testing and current AI-proposed experiments remain unverified.
