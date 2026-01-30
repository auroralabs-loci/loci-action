const fs = require("fs");
const path = require("path");

const exec = require("@actions/exec");
const core = require("@actions/core");
const github = require("@actions/github");

const sleep = ms => new Promise(r => setTimeout(r, ms));
class PullRequestData {
  constructor(context) {
    if (!context || !context.payload.pull_request) {
      return;
    }

    this.actor = context.payload.sender?.login;
    this.actorType = context.payload.sender?.type;
    this.actorID = context.payload.sender?.id;
    this.baseSHA = context.payload.pull_request.base?.sha;
    this.headSHA = context.payload.pull_request.head?.sha;
    this.baseREF = context.payload.pull_request.base?.ref;
    this.headREF = context.payload.pull_request.head?.ref;
    this.prNumber = context.payload.pull_request.number;
    this.eventOwner = context.payload.repository?.owner?.login;
    this.eventRepo = context.payload.repository?.name;
    this.eventRepoFull = context.payload.repository?.full_name;
    this.workflowOwner = context.repo.owner;
    this.workflowRepo = context.repo.repo;
  }

  getSCMMetaData() {
    return {
          owner: this.eventOwner,
          repo: this.eventRepo,
          base: this.baseREF,
          head: this.headREF,
          actor: this.actor,
          head_sha: this.headSHA,
          pr_number: String(this.prNumber)
        };
  }

  async getMergeBaseSHA(token) {
    const octokit = github.getOctokit(token);
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
      owner: this.eventOwner,
      repo: this.eventRepo,
      basehead: `${this.baseSHA}...${this.headSHA}`,
    });
    return data.merge_base_commit.sha.substring(0, 7);
  }
}

function isPullRequest() {
  return "pull_request" === process.env.GITHUB_EVENT_NAME || "pull_request_target" === process.env.GITHUB_EVENT_NAME;
}

function getPullRequestData() {
  if (!isPullRequest()) {
    return null;
  }
  
  const context = github.context;
  if (!context) {
    return null;
  }

  return new PullRequestData(context);
}

async function isAgentic(silent = true) {
  const file = path.join(process.cwd(), "data.json");
  try {
    await exec.exec("loci_api", ["whoami", "--output", file], {
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
    await exec.exec("loci_api", ["status", project, version, "--output", file], {
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
      core.info(`Waiting for ${part} binaries processing to finish. This may take a moment...`);
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