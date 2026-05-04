## LOCI for Azure DevOps

**Line of Code Insights (LOCI)** Agentic AI is the First Hardware-Aware
Optimization Agent for CPUs. It predicts power spikes and Performance
inefficiencies before test or inference. Optimizes code, configs, and serving —
autonomously. It uncovers anomalies in static data, shifts observability left,
and predicts emerging trends in dynamic data, discovering hardware and software
reliability issues, to reduce costs and time to resolution.

This extension provides an Azure Pipelines task (`LociTask@1`) that uploads
compiled binaries to the LOCI backend for performance analysis. It is the
Azure DevOps counterpart of the
[`auroralabs-loci/loci-action`](https://github.com/auroralabs-loci/loci-action)
GitHub Action.

### Scope (v1)

- `mode: upload` — uploads binaries to LOCI. A completed upload is enough for
  the LOCI Inspector dashboard to show analysis results, and for the LOCI
  backend to drive any agentic workflows you have configured.
- Linux agents only (`vmImage: 'ubuntu-latest'`). Windows agents are out of
  scope for v1.
- Source provider: Azure Repos Git is the supported configuration. Pipelines
  fronting GitHub or Bitbucket repos may have reduced functionality on PR
  builds (the merge-base API path requires Azure Repos).

### Quick start

> Before you begin:
> - Add `LOCI_BACKEND_URL` as a pipeline variable.
> - Add `LOCI_API_KEY` as a pipeline secret.
> - Create a long-lived Azure DevOps service-account PAT with **Code (Read & Write)**
>   and **Pull Request Threads (Read & Write)** scopes, store it as a pipeline
>   secret variable (e.g. `LOCI_AZURE_PAT`), and pass it via the `scmToken`
>   task input. LOCI uses this token for merge-base resolution at upload time
>   *and* for the asynchronous post-upload calls (PR comment posting,
>   `@loci-dev` chat). The token must outlive the build because some of those
>   calls fire long after the job ends.

### Example: Build + Upload

```yaml
trigger:
  branches:
    include: [main]
pr:
  branches:
    include: [main]

pool:
  vmImage: 'ubuntu-latest'

variables:
  LOCI_PROJECT: AzureDevOpsDemo

steps:
  - checkout: self
    fetchDepth: 0
    persistCredentials: true

  - script: |
      sudo apt-get update
      sudo apt-get install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
    displayName: 'Prepare environment'

  - script: |
      mkdir -p samples/build/bin
      aarch64-linux-gnu-g++ -o samples/build/bin/sample_01 samples/sample_01.cpp
    displayName: 'Build sample'

  - task: UsePythonVersion@0
    inputs:
      versionSpec: '3.12'
    displayName: 'Setup Python 3.12'

  - task: LociTask@1
    displayName: 'LOCI Upload'
    inputs:
      mode: upload
      project: $(LOCI_PROJECT)
      binaries: samples/build/bin/
      scmToken: $(LOCI_AZURE_PAT)   # long-lived PAT, stored as a pipeline secret
    env:
      LOCI_API_KEY: $(LOCI_API_KEY)
      LOCI_BACKEND_URL: $(LOCI_BACKEND_URL)
```

The task logs an Inspector dashboard link in its output and writes the same
link to the build's Summary tab. Click through to view function insights and,
in agentic mode, the Agent Summary Report.

### Why `UsePythonVersion@0` first

Azure Pipelines tasks can't bundle other prerequisite tasks. The LOCI task
needs Python 3.12+ to run `loci_api`, so the customer's pipeline must add
`UsePythonVersion@0` (or otherwise put a 3.12+ `python` on PATH) before
`LociTask@1`. The task probes the runtime Python version and fails with the
exact YAML to paste if the prerequisite is missing.

### Inputs

| Input      | Required | Default | Description |
|------------|:--------:|:-------:|-------------|
| `mode`     | ✅ Yes  | `upload` | Operation to perform. v1 supports `upload` only; `summary` is planned for a future release. |
| `project`  | ✅ Yes  | — | LOCI project name to tag analysis results. |
| `binaries` | ✅ Yes  | — | Newline-separated list of binary paths, glob patterns, or a directory. |
| `target`   | No      | `<branch>@<shortSHA>` | Project version label for this run. Auto-resolves if not set. |
| `base`     | No      | PR merge base (on PR builds) | Base version to compare `target` against. Empty unless set or PR context. |
| `waitBase` | No      | `true` | Whether to wait for the base version's processing to finish. |
| `optimize` | No      | `false` | Use the LOCI Coding Agent to optimize uploaded binaries. PR builds in agentic mode only; ignored otherwise (a warning is logged). |
| `scmToken` | ✅ Yes  | — | Long-lived Azure DevOps PAT used by LOCI for SCM API calls (PR comment posting, `@loci-dev` chat, merge-base resolution). Pass via a pipeline secret variable, e.g. `scmToken: $(LOCI_AZURE_PAT)`. |

### Outputs

`LociTask@1` exposes these as step output variables (`$(LOCI_Upload.target)`,
where `LOCI_Upload` is the step's `name:`) and as plain pipeline variables
(`$(LOCI_TARGET)`, `$(LOCI_BASE)`):

| Variable     | Description |
|--------------|-------------|
| `target`     | Resolved project version name for this run. |
| `base`       | Resolved base version name (may be empty). |
| `LOCI_TARGET`| Same as `target`, exposed as a pipeline variable for downstream tasks. |
| `LOCI_BASE`  | Same as `base`, exposed as a pipeline variable for downstream tasks. |

### Where to view results

The Azure task uploads binaries; analysis output lives on the LOCI Inspector
dashboard.

1. Click the **LOCI Inspector** link the upload step writes to the build's
   Summary tab and to its log output.
2. The Inspector dashboard renders the full report including function
   insights, the Agent Summary Report (in agentic mode), and comparison
   analysis when a base version is set (auto-detected on PR builds).

### Feature matrix (Azure v1 vs. GitHub)

| Feature                    | Azure v1                                | GitHub Action |
|----------------------------|------------------------------------------|---------------|
| Upload of binaries         | ✅ Yes                                  | ✅ Yes |
| `--scm-meta` on PR builds  | ✅ Yes (Azure Repos source provider)    | ✅ Yes |
| LOCI optimize on PR builds | ✅ Yes (agentic mode)                   | ✅ Yes |
| Inspector dashboard link   | ✅ Yes (logged + Summary tab)           | ✅ Yes |
| Windows agents             | ❌ Not yet                              | n/a |

### Troubleshooting

**`Python 3.12+ not found on PATH`**
Add `UsePythonVersion@0` with `versionSpec: '3.12'` immediately before
`LociTask@1`. The task error message contains the exact YAML to paste.

**`Failed to get merge-base SHA. Verify the scmToken input is set (with Code (Read) scope) or use checkout with fetchDepth: 0.`**
Either:
- Verify `scmToken` is set on the `LociTask@1` step and the PAT has at least
  **Code (Read)** scope (preferred — uses the Azure DevOps API).
- Or set `fetchDepth: 0` on `checkout: self` (so the local `git merge-base`
  fallback has enough history).

**Source provider is GitHub or Bitbucket**
The `--scm-meta` flow uses the Azure DevOps git API for PR context. Pipelines
fronting non–Azure-Repos sources are not exercised in v1; some PR-side
features (notably the API-based merge-base resolution) may be unavailable.
