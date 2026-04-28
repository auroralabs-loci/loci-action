const fs = require("fs");
const utils = require("./utils");
const tl = require("azure-pipelines-task-lib/task");

async function resolveVersions(pullRequestData = null, providedBase = null, providedTarget = null, token = null) {
  if (providedBase) {
    console.log(`Provided base version: ${providedBase}. Explicitly defined version takes priority over the detected merge base (if any).`);
  }

  if (providedTarget) {
    console.log(`Provided target version: ${providedTarget}. Explicitly defined version takes priority over the detected HEAD.`);
  }

  if (pullRequestData) {
    const base = providedBase || `${pullRequestData.baseREF}@${(await pullRequestData.getMergeBaseSHA(token)).substring(0, 7)}`;
    const target = providedTarget || `${pullRequestData.headREF}@${pullRequestData.headSHA.substring(0, 7)}`;
    return { base, target };
  }

  let head = "";
  try {
    const sha = (tl.getVariable("Build.SourceVersion") || "").substring(0, 7);
    const ref = tl.getVariable("Build.SourceBranchName") || "";
    head = `${ref}@${sha}`;
  } catch (error) {
    head = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  }

  const base = providedBase ? providedBase : "";
  const target = providedTarget ? providedTarget : head;
  return { base, target };
}

async function run() {
  try {
    const iToken = tl.getVariable("System.AccessToken");
    const iProject = tl.getInput("project", true);
    const iTarget = tl.getInput("target", false);
    const iBase = tl.getInput("base", false);
    const iWaitBase = tl.getBoolInput("waitBase", false);

    const pullReq = utils.getPullRequestData();

    const { base, target } = await resolveVersions(pullReq, iBase, iTarget, iToken);
    console.log("##[group]Trigger context");
    console.log(`Event: ${tl.getVariable("Build.Reason") || ""}`);
    if (pullReq) {
      console.log(`Base branch: ${pullReq.baseREF}`);
      console.log(`Head branch: ${pullReq.headREF}`);
    } else {
      console.log(`Commit: ${tl.getVariable("Build.SourceVersion") || ""}`);
    }
    console.log(`Actor: ${tl.getVariable("Build.RequestedFor") || ""}`);

    if (base) {
      console.log("Comparison Analysis");
      console.log(`Base: ${base}`);
      console.log(`Target: ${target}`);
      if (pullReq) {
        console.log(`PullRequest: #${pullReq.prNumber}`);
      }

      let status_code = null;
      let status_message = '';
      if (iWaitBase) {
        const { status, sm, _ } = await utils.waitVersionProcessingToFinish(iProject, base, true);
        status_code = status;
        status_message = sm || 'Unknown error';
      } else {
        const { status, sm, _ } = await utils.fetchVersionStatus(iProject, base);
        status_code = status;
        status_message = sm || 'Unknown error';
        if (status_code == -1) {
          throw new Error("Base version is still being processed. Comparison terminated (waiting disabled).\n" +
          "Tip: Re-run this task with 'waitBase' set to true to wait for the base version automatically.");
        }
      }
      if (status_code == 0) {
        console.log("Base version is ready. Proceeding with comparison.");
      } else {
        throw new Error(`Base version failed to process successfully: ${status_message}. Comparison aborted.`);
      }
    } else {
      console.log("Single Analysis");
      console.log(`Target: ${target}`);
    }
    console.log("##[endgroup]");

    tl.setVariable("target", target, false, true);
    tl.setVariable("base", base, false, true);

    tl.setVariable("LOCI_TARGET", target);
    tl.setVariable("LOCI_BASE", base);
  } catch (err) {
    throw new Error(`Resolving versions failed: ${err.message}`);
  }
}

module.exports = { run };
