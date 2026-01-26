## LOCI GitHub Action


[![View on Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-View%20Action-blue?logo=github)](https://github.com/marketplace/actions/loci-action) [![Check Workflow Runs](https://img.shields.io/badge/Workflow%20Runs-View%20on%20GitHub-orange?logo=githubactions)](https://github.com/auroralabs-loci/loci-action/actions)


**Line of Code Insights (LOCI)** Agentic AI is the First Hardware-Aware Optimization Agent for CPUs. It predicts power spikes and Performance inefficiencies before test or inference. Optimizes code, configs, and serving - autonomously. It uncovers anomalies in static data, shifts observability left, and predicts emerging trends in dynamic data, discovering hardware and software reliability issues, to reduce costs and time to resolution. 

LOCI lets you upload compiled binaries for performance analysis, view insights directly in your workflow summary, and (if you install the GitHub App) automatically receive PR comments with results.

- `upload`: uploads binaries in `LOCI`.
- `summary`: waits for the analysis to complete and attaches the Agent Report to the workflow run summary.
  
  Comments on PRs are posted automatically by the GitHub App after completed binaries upload.

### Quick start

> Before you begin:
> - Add `LOCI_BACKEND_URL` as a GitHub Variable.
> - Add `LOCI_API_KEY` as a GitHub Secret.
> - Install the LOCI `GitHub App` on your repo if you want automatic PR comments and overall Performance Reviews.
> - (optional, `agentic mode only`) If you want the summary step to add the summary report to the workflow job UI (note that the job will wait for the binaries upload and analysis to finish), add a Personal Access Token in a `LOCI_GITHUB_TOKEN` env variable for our action (we advice to store the actual token as a GitHub Secret).

### Example: Build + Upload

```yaml
name: LOCI Integration
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main]

env:
  LOCI_PROJECT: GHDemo

jobs:
  build-and-upload:
    runs-on: ubuntu-latest
    steps:
      - name: Prepare environment
        run: |
          sudo apt-get update
          sudo apt-get install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
        shell: bash

      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Build sample
        run: |
          mkdir -p samples/build/bin
          aarch64-linux-gnu-g++ -o samples/build/bin/sample_01 samples/sample_01.cpp
        shell: bash

      - name: Upload Artifacts
        uses: auroralabs-loci/loci-action@v1
        env:
          LOCI_API_KEY: ${{ secrets.LOCI_API_KEY }}
          LOCI_BACKEND_URL: ${{ vars.LOCI_BACKEND_URL }}
        with:
          mode: upload
          project: ${{ env.LOCI_PROJECT }}
          binaries: samples/build/bin/
```

### Example: Build + Upload + Summary (adds report and insights to job UI)

```yaml
jobs:
  build-upload-and-summary:
    runs-on: ubuntu-latest
    steps:
      # ... build steps ...

      - name: LOCI Upload
        uses: auroralabs-loci/loci-action@v1
        env:
          LOCI_API_KEY: ${{ secrets.LOCI_API_KEY }}
          LOCI_BACKEND_URL: ${{ vars.LOCI_BACKEND_URL }}
        with:
          mode: upload
          project: ${{ env.LOCI_PROJECT }}
          binaries: samples/build/bin/

      - name: LOCI Summary
        uses: auroralabs-loci/loci-action@v1
        env:
          LOCI_API_KEY: ${{ secrets.LOCI_API_KEY }}
          LOCI_BACKEND_URL: ${{ vars.LOCI_BACKEND_URL }}
          LOCI_GITHUB_TOKEN: ${{ secrets.LOCI_GITHUB_TOKEN }} # required only for agent summary (if agentic mode is enabled)
        with:
          mode: summary
          project: ${{ env.LOCI_PROJECT }}
```

#### Good to know

- The upload step is enough for the GitHub App to add a comment on the PR (if installed and the company has agentic mode enabled).
- The summary step is only needed if you want the workflow run summary to show the LOCI Report and Top Function Insights.


### Inputs

| Input           |       Required      |              Default             | Description                                                                                          |
| --------------- | :-----------------: | :------------------------------: | ---------------------------------------------------------------------------------------------------- |
| `mode`          |        ✅ Yes        |                 —                | Operation to perform: `upload` or `summary`.                                                         |
| `project`       |        ✅ Yes        |                 —                | Project name to tag analysis results.                                                                |
| `binaries`      | *Only for `upload`* |                 —                | Newline-separated list of binary paths, glob patterns or a directory. Required for `upload`, ignored for `summary`. |
| `target`        |          No         |       `<branch>@<shortSHA>`      | Project version label. Auto-resolves if not set.                                                     |
| `base`          |          No         | PR merge base (on pull requests) | Base version to compare against. Empty unless set or PR context.                                     |
| `top-n-symbols` |        ✅ Yes        |                `5`               | Number of functions shown in function insights in the `summary` step.                                |

### Outputs

| Output    | Description                                              |
| --------- | -------------------------------------------------------- |
| `target`  | Resolved project version name for this run.              |
| `base`    | Resolved base version name (may be empty).               |
| `summary` | LOCI Agent Summary Report (only available when `mode: summary`). |


### LOCI Features Overview

| Feature                       | Standard Mode              | Agentic Mode                                                                                       | GitHub App Required? | Where it appears                                          |
| ----------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| **Upload of binaries**        | ✅ Yes                      | ✅ Yes                                                                                              | ❌ No                 | LOCI Inspector (always)                                   |
| **Function Insights** | ✅ Yes (via `summary` step) | ✅ Yes (via `summary` step)                                                                         | ❌ No                 | Workflow run summary (summary step)                       |
| **LOCI Agent Summary Report**      | ❌ Not available            | ✅ Yes<br>– In workflow run summary (if `summary` step added)<br>– As PR comment (if App installed) | ✅  For PR comment    | Workflow run summary (summary step) & PR comment (App)    |
| **Performance Review Check**  | ❌ Not available            | ✅ Yes                                                                                              | ✅  Yes (App only)    | GitHub Checks tab (pass/fail based on `.github/loci.yml` user configuration) |

### How it works

- Upload step → always required; uploads binaries to LOCI backend.
- Summary step →
  - Standard mode → adds top-n Function Insights only.
  - Agentic mode → adds Agent Summary Report + Function Insights.
- GitHub App installed →
  - Posts LOCI Agent Summary Report as a PR comment (Agentic only).
  - Enables Performance Review Check Run (pass/fail).