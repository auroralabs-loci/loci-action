## LOCI for Azure DevOps

This extension contributes an Azure Pipelines task (`LociTask@1`) that uploads
compiled binaries to the LOCI backend for performance analysis. It is the
Azure DevOps counterpart of the
[`auroralabs-loci/loci-action`](https://github.com/auroralabs-loci/loci-action)
GitHub Action.

### Prerequisites

Set these on the pipeline (or as variable group entries):

- `LOCI_BACKEND_URL` — pipeline variable.
- `LOCI_API_KEY` — pipeline **secret** variable.
- `scmToken` — long-lived Azure DevOps service-account PAT stored as a
  pipeline secret (e.g. `LOCI_AZURE_PAT`), with the following scopes:
  - **Code** (Read & Write)
  - **Identity** (Read)
  - **Pull Request Threads** (Read & Write)
  - **Tokens** (Read & Manage)

  The task forwards it to the LOCI backend, which uses it for merge-base
  resolution at upload time and for asynchronous post-upload calls (PR
  comment posting, `@<bot-name>` chat). The token must outlive the build
  because those calls fire after the job ends.

### LOCI bot identity

Backend-driven PR comments are posted by a dedicated Azure DevOps user (the
"LOCI bot") whose PAT is the one configured above. You can name that user
whatever you like, but the **same display name must be set on the backend
as the `AZURE_BOT_IDENTITY` env var** so the bot recognises its own
comments and mentions. The `@<bot-name>` placeholder used throughout this
README refers to whatever you set there.

### Service hook for PR chat

To enable `@<bot-name>` chat replies, register a service hook so Azure DevOps
notifies the LOCI backend when someone comments on a PR:

In Azure DevOps go to **Project Settings → Service hooks → Create
subscription**, choose **Web Hooks**, select the **Pull request commented
on** event, and set the URL to
`<dash_url>/webhook/azure`. If you set a Basic
authentication password on the subscription, that same value must be
configured on the backend as the `SERVICE_HOOK_PASSWORD` env var (username
is ignored).

### Quick start

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

  - script: echo "Build project here"
    displayName: 'Build project'

  - task: LociTask@1
    name: LOCI_Upload
    displayName: 'LOCI Upload'
    inputs:
      mode: upload
      project: $(LOCI_PROJECT)
      binaries: path/to/your/binaries/
      scmToken: $(LOCI_AZURE_PAT)
    env:
      LOCI_API_KEY: $(LOCI_API_KEY)
      LOCI_BACKEND_URL: $(LOCI_BACKEND_URL)
```

### Inputs

| Input      | Required | Default | Description |
|------------|:--------:|:-------:|-------------|
| `mode`     | ✅ | `upload` | Operation to perform. v1 supports `upload` only. |
| `project`  | ✅ | — | LOCI project name to tag analysis results under. |
| `binaries` | ✅ | — | Newline-separated list of binary paths, glob patterns, or a directory. Non-ELF entries are filtered out. |
| `target`   | No | `<branch>@<shortSHA>` | Project version label for this run. Auto-resolved from build context; set explicitly to override. |
| `base`     | No | PR merge base on PR builds | Base version to compare `target` against. Auto-resolved on PRs; set explicitly to override (or to force a comparison on non-PR builds). |
| `waitBase` | No | `true` | Wait for the base version's processing to finish before uploading the target. Comparison analysis cannot run otherwise — leave on unless you specifically want to fail fast. |
| `scmToken` | ✅ | — | Long-lived Azure DevOps PAT used by LOCI for SCM API calls. Pass via a pipeline secret, e.g. `scmToken: $(LOCI_AZURE_PAT)`. |

### Outputs

| Variable      | Kind                                   | Description |
|---------------|----------------------------------------|-------------|
| `target`      | Step output (`$(<stepName>.target)`)   | Resolved project version name for this run. |
| `base`        | Step output (`$(<stepName>.base)`)     | Resolved base version name (may be empty). |
| `LOCI_TARGET` | Pipeline variable (`$(LOCI_TARGET)`)   | Same value as `target`, available to all downstream tasks. |
| `LOCI_BASE`   | Pipeline variable (`$(LOCI_BASE)`)     | Same value as `base`, available to all downstream tasks. |

### Viewing results

Open the **LOCI Upload** step's log and look at the last line — the task
prints the LOCI dashboard URL there. On PR builds, the same analysis is
also one click away from **Checks → Performance overview**, whose target
URL deep-links straight to the latest comparison view.

### Setting the repository URL

For `@<bot-name>` chat replies to route back to the right PR, the LOCI
project must know which Azure DevOps repository it belongs to. Open the
project in the LOCI dashboard and set **repository-url** to the full Azure
DevOps repo URL. Without it, the chatbot won't respond.

### Rotating the SCM PAT

Azure DevOps PATs expire. When you rotate yours:

1. Update the pipeline secret/variable (e.g. `LOCI_AZURE_PAT`) with the new
   token so future builds can authenticate.
2. Open the LOCI dashboard, go to your project, click **Personal Access
   Token** in the top-right corner, and paste the same new token there.
   The backend uses this token for the asynchronous post-upload calls
   (PR comments, `@<bot-name>` chat) that fire after the build is gone.

If you forget step 2, the project view shows an error indicator letting
you know the stored token is no longer valid.

### Troubleshooting

**Base version is missing.**
The comparison can't run because the resolved base isn't available. The
usual causes are: the base branch was never uploaded to LOCI, the base
upload is still processing and `waitBase: false` was set, or the base's
own analysis failed. Make sure the base branch has a successful LOCI run
to compare against; for in-flight processing, keep `waitBase: true` (the
default) so the task polls until the base is ready.

**Account is not configured for agentic mode.**
Some features require the company to be agentic.
Open your project's **Company details** in the LOCI dashboard and switch
the company to agentic mode (or ask a LOCI admin to do it).

**`@<bot-name>` chat isn't responding.**
Check that **repository-url** is set on your LOCI project (see above) and
that the service hook for **Pull request commented on** is registered and
pointing at `<dash_url>/webhook/azure` with the matching
`SERVICE_HOOK_PASSWORD` on the backend.
