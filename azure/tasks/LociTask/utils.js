const fs = require("fs");
const path = require("path");

const tl = require("azure-pipelines-task-lib/task");
const azdev = require("azure-devops-node-api");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripRefsHeads(ref) {
  if (!ref) return ref;
  return ref.replace(/^refs\/heads\//, "");
}

// Pull the Azure DevOps organization name out of the build's collection URI.
// Modern form: https://dev.azure.com/<org>/  -> "<org>"
// Legacy form: https://<org>.visualstudio.com/  -> "<org>"
// Backend's AzureProvider uses scm.owner verbatim to build the API URL
// (https://dev.azure.com/${scm.owner}), so this MUST be the org, not the
// team project — they're different on Azure DevOps.
function extractOrgFromCollectionUri(uri) {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    if (url.hostname === "dev.azure.com") {
      const seg = url.pathname.split("/").filter(Boolean)[0];
      return seg || undefined;
    }
    if (url.hostname.endsWith(".visualstudio.com")) {
      return url.hostname.split(".")[0];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

class PullRequestData {
  constructor() {
    if (!isPullRequest()) {
      return;
    }

    this.actor = tl.getVariable("Build.RequestedFor");
    this.actorType = undefined;
    this.actorID = tl.getVariable("Build.RequestedForId");
    this.baseSHA = undefined;
    this.headSHA = tl.getVariable("System.PullRequest.SourceCommitId");
    this.baseREF = stripRefsHeads(tl.getVariable("System.PullRequest.TargetBranch"));
    this.headREF = stripRefsHeads(tl.getVariable("System.PullRequest.SourceBranch"));
    this.prNumber = tl.getVariable("System.PullRequest.PullRequestId");
    this.adoProject = tl.getVariable("System.TeamProject");
    this.eventOwner = extractOrgFromCollectionUri(tl.getVariable("System.CollectionUri")) || this.adoProject;
    this.eventRepo = tl.getVariable("Build.Repository.Name");
    this.eventRepoFull = this.eventOwner && this.eventRepo
      ? `${this.eventOwner}/${this.eventRepo}`
      : undefined;
    this.workflowOwner = this.eventOwner;
    this.workflowRepo = this.eventRepo;
  }

  getSCMMetaData() {
    return {
          owner: this.eventOwner,
          repo: this.eventRepo,
          base: this.baseREF,
          head: this.headREF,
          actor: this.actor,
          head_sha: this.headSHA,
          pr_number: String(this.prNumber),
          provider: "azure",
          ado_project: this.adoProject
        };
  }

  async getMergeBaseSHA(token) {
    if (token) {
      console.log("Resolving merge-base SHA via Azure DevOps API.");
      try {
        const handler = azdev.getPersonalAccessTokenHandler(token);
        const orgUrl = tl.getVariable("System.CollectionUri");
        const conn = new azdev.WebApi(orgUrl, handler);
        const git = await conn.getGitApi();
        const repoId = tl.getVariable("Build.Repository.ID");
        const project = tl.getVariable("System.TeamProject");

        if (!this.baseSHA && this.prNumber) {
          const pr = await git.getPullRequestById(parseInt(this.prNumber, 10), project);
          this.baseSHA = pr && pr.lastMergeTargetCommit && pr.lastMergeTargetCommit.commitId;
        }

        if (this.baseSHA && this.headSHA) {
          const bases = await git.getMergeBases(repoId, this.baseSHA, this.headSHA, project);
          const found = bases && bases[0] && bases[0].commitId;
          if (found) {
            return found.substring(0, 7);
          }
        }
        throw new Error("Merge-base API returned no commits.");
      } catch (err) {
        tl.warning(`Failed to get merge-base via API: ${err.message}. Falling back to git.`);
      }
    }

    try {
      console.log("Resolving merge-base SHA via local git.");
      // Azure Pipelines checks out the synthetic merge commit by default on PR builds:
      // HEAD^1 is the target tip, HEAD^2 is the source tip.
      const { execSync } = require("child_process");
      const mergeBase = execSync("git merge-base HEAD^1 HEAD^2", {
        encoding: "utf-8",
      }).trim();
      return mergeBase.substring(0, 7);
    } catch (err) {
      throw new Error(
        `Failed to get merge-base SHA. Verify the scmToken input is set (with Code (Read) scope) or use checkout with fetchDepth: 0. Error: ${err.message}`
      );
    }
  }
}

function isPullRequest() {
  return tl.getVariable("Build.Reason") === "PullRequest";
}

function getPullRequestData() {
  if (!isPullRequest()) {
    return null;
  }
  return new PullRequestData();
}

async function isAgentic(silent = true) {
  const file = path.join(process.cwd(), "data.json");
  try {
    await tl.exec("loci_api", ["whoami", "--output", file], {
      silent: silent,
    });
  } catch (err) {
    throw new Error(
      `Cannot obtain authenticated account information.`
    );
  }

  try {
    let data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!data) {
      return false;
    }
    return data.agentic;
  } catch (e) {
    throw new Error(`Failed to read authenticated account details. ${e.message}.`);
  }
}

async function fetchVersionStatus(project, version, silent = true, retryAfterFailure = false) {
  const file = path.join(process.cwd(), "data.json");
  try {
    await tl.exec("loci_api", ["status", project, version, "--output", file], {
      silent: silent,
    });
  } catch (err) {
    if (retryAfterFailure) {
      // retry once after delay in case version is on its way to be created (we are not able to fetch status yet)
      await sleep(10_000);
      return fetchVersionStatus(project, version, silent, false);
    }
    throw new Error(
      `Version '${version}' does not exist. (${err}).`
    );
  }

  try {
    let data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!data) {
      return { status: 1, status_message: '', url: '' };
    }
    return { status: parseInt(data.status), status_message: data.status_message, url: data.url };
  } catch (e) {
    throw new Error(`Failed to obtain version status. ${e.message}.`);
  }
}

async function fetchVersionStatusWithDetails(project, target, silent = true, allowInProgress = false, retryAfterFailure = false) {
  const { status, status_message, url } = await fetchVersionStatus(project, target, silent, retryAfterFailure);

  if (!allowInProgress && status === -1) {
    return { status: -1, details: null };
  }

  const details = {
    message: allowInProgress
      ? '🟄 Check the current upload progress status and any updates in'
      : (status === 0
        ? '🟄 Explore the in-depth analysis in'
        : '× Analysis unavailable at the moment. Check for more info in'),
    label: 'LOCI Inspector',
    url: url || ''
  };

  return { status: status, status_message: status_message, details: details };
}

async function waitVersionProcessingToFinish(
  project,
  version,
  isBase,
  {
    initialDelay = 30_000,
    factor = 1.7,
    maxDelay = 60_000
  } = {}
) {
  let base = initialDelay;
  let logWaitMessage = true;

  while (true) {
    const { status, status_message, details } = await fetchVersionStatusWithDetails(project, version, true, false, true);
    if (status !== -1 ) {
      return {status, status_message, details };
    }

    if (logWaitMessage) {
      logWaitMessage = false;
      const part = isBase ? 'base version' : 'target version';
      console.log(`Waiting for ${part} binaries processing to finish. This may take a moment...`);
    }

    base = Math.min(maxDelay, Math.round(base * factor));
    const delay = Math.floor(Math.random() * base);
    await sleep(delay);
  }
}


module.exports = {
  isAgentic: isAgentic,
  isPullRequest: isPullRequest,
  getPullRequestData: getPullRequestData,
  fetchVersionStatus: fetchVersionStatus,
  fetchVersionStatusWithDetails: fetchVersionStatusWithDetails,
  waitVersionProcessingToFinish: waitVersionProcessingToFinish
};
