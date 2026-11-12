# CaptureProof

CaptureProof is a local debugging tool for PayPal integrations. It compares provider capture state with merchant records, links mismatches to source code, and packages the evidence in a report you can inspect offline.

[Watch the 2:59 demonstration](https://youtu.be/lVA9luL7J9Y) · [Open the included report](data/portable-reports/reviewed-v6-journey-2026-11-12/report.html)

## What the example shows

The provider capture is **PENDING**, but the original integration has already recorded completed payment and one capture row. At the same boundary, a separately developer-authored repair keeps the merchant state authorized and records no capture row. Later observations and saved replay results are shown separately.

The example uses actual Medusa, PostgreSQL and PayPal SDK execution with **simulated PayPal**. A real saved OpenAI response explains the code path with source citations. It passed structural validation and same-development-session semantic review. The AI's proposed changes and tests were not executed; the tested repair was authored independently.

## Open the report

Download or clone this repository, then open [the included report](data/portable-reports/reviewed-v6-journey-2026-11-12/report.html) locally. It needs no server, credentials or dependencies. GitHub's HTML source page does not run the report.

For a read-only local report server on the supported Mac with Node 24+:

```sh
npm run start:example -- 3100
```

Open **http://127.0.0.1:3100/examples/reviewed-v6**. Navigate **Overview / Evidence / AI review / Repair / Files**. Files provides evidence and frozen-source downloads; the report also works offline.

## Verify a supported change

The executable application is separate from the report. Start it with:

```sh
npm run start:verification -- 3200
```

Open **http://127.0.0.1:3200/external**, choose **Verify my change**, select a supported candidate and click **Review execution plan · no execution**. Viewing a plan does not run it. The bundled report is an earlier frozen result, not a result for your newly selected candidate.

To edit and register a candidate:

```sh
npm run verify -- init my-change
# Edit candidates/my-change/provider.cjs and its listed helpers.
npm run verify -- import my-change
```

Before explicitly running a campaign, follow the [setup and execution guide](docs/OPERATIONS.md). It explains dependency setup, supported files, state directories, export and replay. Candidates are trusted local CommonJS integrations for the pinned Medusa target; arbitrary repositories are unsupported.

## Tests and requirements

```sh
npm test
npm run verify -- check
```

Tests are offline. Execution requires **macOS Apple Silicon, Node 24+, npm and sandbox-exec**, plus pinned Medusa 2.7.0 and PayPal SDK 1.0.0 dependencies. The check command reports missing prerequisites; it starts no integration. Other platforms can inspect the portable HTML.

## Scope

Deterministic rules own the payment findings. A checkpoint PASS is not general correctness, and the saved AI review is not general model accuracy. Reading or downloading evidence starts no campaign, replay or model request.

Separate genuine Sandbox checkout and response-discard recovery were observed during development. They do not make this simulated-provider example a live PayPal test. See [operations and evidence boundaries](docs/OPERATIONS.md) for the separate checkout, optional model generation and limitations.

## Documentation and license

[Operating guide](docs/OPERATIONS.md) · [Recording route](docs/DEMO.md) · [Submission notes and attribution](docs/SUBMISSION.md)

MIT, Copyright (c) 2026 Jeongui Hong. See [LICENSE](LICENSE) and [third-party notices](LICENSES.md).
