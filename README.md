# CaptureProof — release candidate

CaptureProof checks a supported PayPal integration against independent payment-provider and merchant observations. It includes an executable local candidate workflow and an offline recorded report. **The static report is evidence for selected past executions, not the full application or a certification.**

Run the commands below from the prepared distribution directory, not the original historical workspace.

[Recorded demo script](docs/DEMO.md) · [Submission draft and missing inputs](docs/SUBMISSION.md). These new publication documents do not change the immutable example or imply another installation/reproduction.

This local public-source staging candidate is prepared for owner review, **not published and not a final frozen release**. Original CaptureProof material owned by Jeongui Hong is licensed under **MIT**, **Copyright (c) 2026 Jeongui Hong**, in [LICENSE](LICENSE). This does not relicense third-party material. Preserve the third-party notices in `LICENSES.md`.

## 1. Inspect the recorded example first — no credentials or installation

Open `data/portable-reports/upstream-pending-replayed-2026-10-29/report.html` directly in a browser. That one HTML file embeds evidence, executed source, the separately authored repair comparison, matching historical AI response/review and downloadable artifacts. It works offline. The adjacent manifest hashes the delivered HTML; embedded checksums cover downloads. No original database is required.

On the supported Mac with Node 24+, an optional read-only server is:

```sh
npm run start:example -- 3100
```

Open **http://127.0.0.1:3100/external**. Download the whole HTML at **http://127.0.0.1:3100/examples/upstream-pending/download**, or use the report's buttons to save its exact reproducer/evidence. This server allows only selected reads, scrubs inherited credentials, blocks outgoing application network calls and uses macOS sandbox-exec. It cannot launch a verification. `npm run start:demo -- 3100` in the distribution is an alias for this recorded path.

The upstream example observed a PENDING provider capture while Medusa recorded completed payment and one capture row. Its repair retained merchant state `authorized` with zero capture rows while pending, then recorded one row after completed read-back. `authorized` is a local merchant state here; it does not establish an actual PayPal authorization event or money movement. These are saved **actual Medusa/PostgreSQL/SDK executions with simulated PayPal**, not live Sandbox evidence. The stored AI response remains **structural ACCEPTED / preservation PASS / semantic PARTIAL; approved reuse blocked**. Replay success applies only to the exact identified exported artifact and saved replay receipt. Reading or exporting never constitutes a new replay.

The reviewed current comparison is also available offline at [Current comparison report](data/portable-reports/developer-reviewed-2026-11-06/report.html). It identifies its own campaign and exact replay inputs, has no matching AI response, and does not inherit the historical example’s AI review. Opening HTML or downloading a reproducer does not execute it. Running a replay requires the supported installed workspace described below.

## 2. Check execution capability

Use a normal Terminal outside a parent sandbox. The controller must create each database/worker's own OS sandbox; applying an outer sandbox can prevent that. A different port alone does not fix the execution context. `npm run start:verification` removes inherited credentials and loads no `.env`; external application HTTP is blocked. The bounded child-sandbox check runs only an OS utility, not candidate code or PostgreSQL. It establishes sandbox application capability, while each real execution independently checks its full containment and database observations.

The UI separates dependencies, isolation capability and active execution. It caches capability for 30 seconds; every new admission or explicit retry rechecks it server-side. **Recheck capability** starts no campaign. Missing dependencies and unavailable isolation have different recovery actions; there is no unsandboxed candidate fallback.

### Install only if dependencies are missing

Supported runner: **macOS on Apple Silicon, Node.js 24+ with npm, `/usr/bin/sandbox-exec`**, and permission to start local isolated PostgreSQL processes. Other platforms are not supported. Root npm installation is unnecessary. The runtime uses pinned Medusa **2.7.0**, PayPal Server SDK **1.0.0**, embedded PostgreSQL package **16.14.0-beta.17**, and the exact transitive lockfile. Source and pin provenance are in `external/medusa-persistence/provenance.json`.

```sh
npm test
npm run verify -- check
# Only if dependencies are missing; this downloads public registry packages:
npm run external:setup
npm run verify -- check
```

Distribution `npm test` runs only the listed offline unit/HTTP/packaging tests; it starts no Medusa/PostgreSQL experiment. Setup uses `npm ci --ignore-scripts`, restores declared native-package symlinks, and checks published-source parity and pinned hashes. No dependencies or databases are bundled. Do not weaken isolation when preflight reports a blocker. The November 4 release manifest was installed successfully on November 5 in its separate directory on the existing Mac: 598 packages, unchanged pins/source parity and READY preflight. One exported upstream failure was actually reproduced. This is not new-machine validation; recorded viewing still needs no runtime packages.

## 3. Register a supported candidate, then explicitly verify

```sh
npm run verify -- init my-change
# Edit candidates/my-change/provider.cjs and its listed helpers.
npm run verify -- import my-change
npm run start:verification -- 3200
```

Open **http://127.0.0.1:3200/external**. Import freezes validated files without executing them. The included `intentional-rejection` candidate is an explicitly injected defect. The built-in revision 3 follows the same supplied-source contract. Candidates must be trusted local developer code, flat CommonJS files with a `captureproof-medusa-candidate-1` manifest, the pinned target/base hash, and required helpers; arbitrary repositories are not supported.

Choose **Verify my change**, select a candidate and explicitly launch **Run regression campaign**, or `npm run verify -- run <candidate-id>`. Each campaign starts **8 isolated local integration executions**. Provider transport is simulated; the database and installed SDK are real. No API credentials are used. This is separate from reading the example, and was **not run during release preparation**. The historical execution allowance remains 42/42. A separately authorized repair allowance is tracked outside the distributed source; these commands describe capability, not an unlimited execution authorization.

Keep the returned job ID. `npm run verify -- show <job-id>`, reload and reopening with the same state directory read the existing job. UI/CLI default to `data/verification-workspace`; optional CLI `--state <directory>` must correspond to the server's optional state-directory argument. If interrupted, inspect that job's state/error before an explicit retry. Do not blindly repeat launch commands. Missing or unfinished evidence is INCONCLUSIVE, not a completed payment or a successful test.

## 4. Inspect, export and replay the exact result

Open a scenario's **Inspect evidence** link. Provider and committed merchant state appear together. History can remain INCONCLUSIVE while the final checkpoint passes. An initialization failure has no comparable payment results; unobserved scenarios are NOT RUN. Source and separately tested repair are inspectable. Stored AI remains a separate reviewed record; this workflow does not generate a diagnosis.

**Export replayable failure** downloads the exact JSON passed to a new replay. **Export matching repair comparison** keeps the original scenario, origin and rule, replacing only the implementation with the frozen paired candidate. Each replay starts one execution. The runner retains the input bytes and SHA-256, and the report revalidates the saved raw execution, source, scenario and deterministic rules before attaching a replay result. Same request key with different bytes is a conflict. A same-named scenario or an older receipt cannot substitute.

Return to the originating campaign after replay and reopen its evidence. **Open saved replay** and **Open saved repair replay** lead to the linked jobs; a newly downloaded portable HTML includes their verified association. Earlier downloaded reports stay unchanged. An artifact with different bytes remains unverified even if its parsed JSON looks similar.

### Portable report

On a completed execution card, choose **Download portable HTML** beside the evidence/reproducer exports. Or:

```sh
npm run report:export -- ./candidate-report --job <job-id> --run <execution-id> --state data/verification-workspace
```

The destination must not exist. This validates persisted artifact/source identities and starts nothing. FAIL includes its exact failure reproducer. PASS or INCONCLUSIVE without a failing rule is evidence-only. Missing counters remain Unknown; incomplete jobs or corrupt required evidence are refused. AI and repair sections require matching records; they are not mandatory and no response is generated. A new run does not inherit the bundled example's AI or replay result.

To reproduce a saved failure later, `npm run verify -- replay <downloaded-reproducer.json>` starts **one new integration execution**, requiring the installed runtime. Reduction is unnecessary for the recorded exercise. Do not confuse downloading with executing. The no-selection `report:export` command is a historical-workspace convenience; use explicit job/run/state for your own work. To save the bundled example, use its fixed HTML download, not a historical database regeneration.

## 5. Optional external services — separate from local verification

The shipped `.env.example` contains placeholders and safe local defaults only. Copy it locally to ignored `.env`, restrict permissions (`chmod 600 .env`), and enter credentials there, never in chat or source control. `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` must belong to a **Sandbox** app; use a separate Sandbox buyer. `OPENAI_API_KEY` is optional; `OPENAI_MODEL` / `OPENAI_REASONING_EFFORT` retain the existing diagnostic configuration. Configuring a key does not authorize paid evaluation.

`npm start` loads `.env` and opens the separate local Sandbox checkout at **http://127.0.0.1:3000** (or configured PORT). Explicit create/approval/capture/recovery actions can call PayPal Sandbox; explicit diagnosis can incur API cost. Keep these services unconfigured for the recorded exercise. Verification/example startup ignores credentials. No paid model evaluation is included or scheduled; model and Sandbox transactions were not reverified for this release.

## Independent recorded-evidence handoff

Without coaching, open the report; identify the provider/merchant mismatch and a supporting checkpoint; locate the executed source and separately tested repair; download the HTML and exact reproducer; explain which components were simulated and which actually ran. Distinguish the AI review from the deterministic rules and state what the example does **not** establish. Note any confusing steps. Do **not** launch a campaign/replay or external call for this exercise. No tester feedback is fabricated and agent walkthroughs are not independent human validation.

## Distribution integrity and limits

`source-bundle.json` is the explicit staged file list, byte counts and SHA-256 hashes, including original hashes for any documentation/package derivatives. `scripts/prepare-first-use.mjs` contains the release allowlist. Only the two pinned self-contained reports and their two manifests under `data/` are intentionally distributed; private application DBs, environment files, cost ledgers, other experiments, caches and node_modules are excluded. Preserve notices when copying.

The historical report remains byte-identical. Source/evidence digests identify bytes, not publisher authenticity. This public-source candidate is prepared locally on the existing Mac; it is **not** a final frozen release, fresh installation, independent human test, public upload or deployment. The recorded successful same-Mac installation/reproduction belongs to the earlier November 4 release, not this candidate. New-machine installation and broader platform/browser/production correctness remain unverified. MIT adoption is complete; publication still requires an owner-specified destination and separate authorization.
