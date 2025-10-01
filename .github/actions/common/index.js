const path = require("path");

const core = require("@actions/core");
const exec = require("@actions/exec");


async function run() {
  try {
    const actionPath = process.env.GITHUB_ACTION_PATH || ".";
    const requirementsPath = path.join(actionPath, "requirements.txt");

    core.startGroup("Setup python environment");
    await exec.exec("python", ["--version"]);
    core.endGroup();

    core.startGroup("Upgrade pip");
    await exec.exec("pip", ["install", "--upgrade", "pip"]);
    core.endGroup();

    core.startGroup("Install python dependencies");
    await exec.exec("pip", ["install", "-r", requirementsPath]);
    core.info("Python dependencies installed");
    core.endGroup();

    core.info("Python environment ready");
  } catch (err) {
    core.setFailed(`Failed in common action: ${err.message}`);
  }
}

run();