const fs = require("fs");
const path = require("path");

const exec = require("@actions/exec");
const core = require("@actions/core");
const github = require("@actions/github");

class PullRequestData {
  constructor(context) {
    if (!context || !context.payload.pull_request) {
      return;
    }

    this.actor = context.payload.sender?.login;
    this.actorType = context.payload.sender?.type;
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
          head_sha: this.headSHA,
          pr_number: String(this.prNumber)
        };
  }
}

function isPullRequest() {
  return "pull_request" === process.env.GITHUB_EVENT_NAME;
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

async function fetchVersionStatus(project, version, silent = true) {
  const file = path.join(process.cwd(), "data.json");
  try {
    await exec.exec("loci_api", ["status", project, version, "--output", file], {
      silent: silent,
    });
  } catch (err) {
    throw new Error(
      `Version '${version}' does not exist. (${err}).`
    );
  }

  try {
    let data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!data) {
      return { status: 1, url: '' };
    }
    return { status: parseInt(data.status), url: data.url };
  } catch (e) {
    throw new Error(`Failed to obtain version status. ${e.message}.`);
  }
}

async function fetchVersionStatusWithDetails(project, target, silent = true, allowInProgress = false) {
  const { status, url } = await fetchVersionStatus(project, target, silent);

  if (!allowInProgress && status === -1) {
    return { status: -1, details: null };
  }

  const details = {
    message: allowInProgress
      ? '🟄 Check the current upload progress status and any updates in'
      : (status === 0
        ? '🟄 Explore the in-depth analysis in'
        : '× Analysis unavailable at the moment. Check for more info in'),
    label: 'LOCI Dashboard',
    url: url || ''
  };

  return { status: status, details: details };
}


module.exports = {
    isPullRequest: isPullRequest,
    getPullRequestData: getPullRequestData,
    fetchVersionStatus: fetchVersionStatus,
    fetchVersionStatusWithDetails: fetchVersionStatusWithDetails
};