## LOCI for Azure DevOps

This extension contributes an Azure Pipelines task (`LociTask@1`) that uploads
compiled binaries to the LOCI backend for performance analysis. It is the
Azure DevOps counterpart of the
[`auroralabs-loci/loci-action`](https://github.com/auroralabs-loci/loci-action)
GitHub Action.

### Prerequisites

Do these once, before configuring any pipeline.

#### **LOCI dashboard setup**

In the LOCI dashboard:

1. **Enable agentic mode.** Sign in as a company user, open **Company
   Details → Edit**, tick the **agentic** checkbox, and save. This turns on
   the agent features.
2. **Copy your API key.** You'll need it for the `LOCI_API_KEY` pipeline
   secret later. Click the copy icon on the right of the field to copy it
   to your clipboard.
3. **Create or update your project with the Azure repository URL.** Open
   (or create) the LOCI project that will receive uploads and set
   **repository-url** to the full Azure DevOps repo URL. Without it, the
  chatbot can't route replies back to the right PR.

#### **Dedicated LOCI bot user**

Create a dedicated Azure DevOps user — the "LOCI bot" — that owns the PAT
used for SCM API calls and posts the PR comments. Whatever **display name
Azure DevOps shows for that user must be set on the LOCI backend as the
`AZURE_BOT_IDENTITY` env var** so the bot recognizes its own comments and
mentions. The `@<bot-name>` placeholder used throughout this README refers
to that same value. Example:

```yaml
azureDevops:
  botIdentity: "loci auroralabs"
```

Generate a long-lived PAT for that user with the following scopes:

- **Code** (Read & Write)
- **Identity** (Read)
- **Pull Request Threads** (Read & Write)
- **Tokens** (Read & Manage)

Store the PAT as an Azure DevOps pipeline secret (e.g. `LOCI_AZURE_PAT`)
and pass it to the task as `scmToken`. The first task run uploads the
token to the LOCI backend, which then uses it for the async post-upload
calls (PR comments, `@<bot-name>` chat) that fire after the build ends.
You can verify the stored token's validity in the LOCI dashboard under your project's **Personal Access
Token** field (top-right of the project view).

#### Service hook for PR chat

Register a service hook to propagate PR comment events from Azure DevOps
to the LOCI backend — without it, the backend never sees the comments and
`@<bot-name>` chat can't respond. In Azure DevOps go to **Project
Settings → Service hooks → Create subscription**, choose **Web Hooks**,
and set **Trigger on this type of event** to **Pull request commented
on**. Set the URL to `<dash_url>/webhook/azure`. If you set a Basic
authentication password on the subscription, that same value must be
configured on the backend as the `SERVICE_HOOK_PASSWORD` env var
(username is ignored).

### Azure DevOps pipeline setup

Set these on the pipeline (or as variable group entries):

- `LOCI_BACKEND_URL` — pipeline variable.
- `LOCI_API_KEY` — pipeline **secret** variable (copied from the LOCI
  dashboard above).
- `LOCI_AZURE_PAT` — pipeline **secret** variable holding the bot PAT
  generated above; passed to the task as `scmToken`.

#### Quick start

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

#### Inputs

| Input      | Required | Default | Description |
|------------|:--------:|:-------:|-------------|
| `mode`     | ✅ | `upload` | Operation to perform. v1 supports `upload` only. |
| `project`  | No | `$(Build.Repository.Name)` | LOCI project name to tag analysis results under. Defaults to the Azure DevOps repository name when omitted; set explicitly to override. |
| `binaries` | ✅ | — | Newline-separated list of binary paths, glob patterns, or a directory. Non-ELF entries are filtered out. |
| `target`   | No | `<branch>@<shortSHA>` | Project version label for this run. Auto-resolved from build context; set explicitly to override. |
| `base`     | No | PR merge base on PR builds | Base version to compare `target` against. Auto-resolved on PRs; set explicitly to override (or to force a comparison on non-PR builds). |
| `waitBase` | No | `true` | Wait for the base version's processing to finish before uploading the target. Comparison analysis cannot run otherwise — leave on unless you specifically want to fail fast. |
| `scmToken` | ✅ | — | Long-lived Azure DevOps PAT used by LOCI for SCM API calls. Pass via a pipeline secret, e.g. `scmToken: $(LOCI_AZURE_PAT)`. |

#### Outputs

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

### Rotating the SCM PAT

Azure DevOps PATs expire. To rotate, update the pipeline secret/variable
(e.g. `LOCI_AZURE_PAT`) with the new token — the next task run uploads
it to the LOCI backend and replaces the stored copy used for async
post-upload calls (PR comments, `@<bot-name>` chat). If the old token
expires before the next build runs, paste the new token directly into
the project's **Personal Access Token** field in the LOCI dashboard to
unblock those calls immediately. The project view shows an error
indicator when the stored token is no longer valid.

### Troubleshooting

**Base version is missing.**
The comparison can't run because the resolved base isn't available. The
usual causes are: the base branch was never uploaded to LOCI, the base
upload is still processing and `waitBase: false` was set, or the base's
own analysis failed. Make sure the base branch has a successful LOCI run
to compare against; for in-flight processing, keep `waitBase: true` (the
default) so the task polls until the base is ready.

**Account is not configured for agentic mode.**
Some features require the company to be agentic. In the LOCI dashboard,
sign in as a company user, open **Company Details → Edit**, tick the
**agentic** checkbox, and save (or ask a LOCI admin to do it).

**`@<bot-name>` chat isn't responding.**
Check that **repository-url** is set on your LOCI project (see above) and
that the service hook for **Pull request commented on** is registered and
pointing at `<dash_url>/webhook/azure` with the matching
`SERVICE_HOOK_PASSWORD` on the backend.
