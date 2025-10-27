const fs = require("fs");
const utils = require("../utils");

const core = require("@actions/core");


function resolveVersions(pullRequestData = null, providedBase = null, providedTarget = null) {
  if (providedBase) {
    core.info(`Provided base version: ${providedBase}. Explicitly defined version takes priority over the detected merge base (if any).`);
  }

  if (providedTarget) {
    core.info(`Provided target version: ${providedTarget}. Explicitly defined version takes priority over the detected HEAD.`);
  }

  if (pullRequestData) {
    const base = providedBase ? providedBase : `${pullRequestData.baseREF}@${pullRequestData.baseSHA.substring(0, 7)}`;
    const target = providedTarget ? providedTarget : `${pullRequestData.headREF}@${pullRequestData.headSHA.substring(0, 7)}`;
    return { base, target };
  }

  let head = "";
  try {
    const sha = process.env.GITHUB_SHA?.substring(0, 7) || "";
    const ref = process.env.GITHUB_REF_NAME || "";
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
    const iProject = core.getInput("project", { required: true });
    const iTarget = core.getInput("target", { required: false });
    const iBase = core.getInput("base", { required: false });
    const iWaitBase = core.getInput("wait-base", { required: false }) === 'true';

    const pullReq = utils.getPullRequestData();
    const actor = process.env.GITHUB_ACTOR || "";
    const isActorAutomated =
      actor.endsWith("[bot]") ||
      pullReq?.actorType === "Bot" ||
      pullReq?.actorType === "App";
    
    const { base, target } = resolveVersions(pullReq, iBase, iTarget);
    core.startGroup("Trigger context");
    core.info(`Event: ${process.env.GITHUB_EVENT_NAME || ""}`);
    if (pullReq) {
      core.info(`Base branch: ${pullReq.baseREF}`);
      core.info(`Head branch: ${pullReq.headREF}`);
    } else {
      core.info(`Commit: ${process.env.GITHUB_SHA || ""}`);
    }
    core.info(`Actor: ${process.env.GITHUB_ACTOR || ""} (automated: ${isActorAutomated})`);

    if (base) {
      core.info("Comparison Analysis");
      core.info(`Base: ${base}`);
      core.info(`Target: ${target}`);
      if (pullReq) {
        core.info(`PullRequest: #${pullReq.prNumber}`);
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
          "Tip: Re-run this workflow with 'wait-base' parameter set to 'true' to wait for the base version automatically.");
        }
      }
      if (status_code == 0) {
        core.info("Base version is ready. Proceeding with comparison.");
      } else {
        throw new Error(`Base version failed to process successfully: ${status_message}. Comparison aborted.`);
      }
    } else {
      core.info("Single Analysis");
      core.info(`Target: ${target}`);
    }
    core.endGroup();

    core.setOutput("target", target);
    core.setOutput("base", base);

    core.exportVariable("LOCI_TARGET", target);
    core.exportVariable("LOCI_BASE", base);
  } catch (err) {
    core.setFailed(`Resolving versions failed: ${err.message}`);
  }
}

run();
