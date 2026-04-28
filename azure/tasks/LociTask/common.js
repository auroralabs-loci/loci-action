const path = require("path");
const tl = require("azure-pipelines-task-lib/task");


async function run() {
  try {
    console.log("##[group]Verify python environment");
    // ignoreReturnCode: true so we can inspect the exit code ourselves
    // without tl.exec throwing on a deliberate non-zero from sys.exit().
    const pythonCheck = await tl.exec(
      "python",
      ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"],
      { silent: true, ignoreReturnCode: true, failOnStdErr: false }
    );
    if (pythonCheck !== 0) {
      throw new Error(
        "Python 3.12+ not found on PATH. Add UsePythonVersion@0 before LociTask:\n" +
        "  - task: UsePythonVersion@0\n" +
        "    inputs:\n" +
        "      versionSpec: '3.12'"
      );
    }
    await tl.exec("python", ["--version"]);
    console.log("##[endgroup]");

    console.log("##[group]Upgrade pip");
    await tl.exec("pip", ["install", "--upgrade", "pip"]);
    console.log("##[endgroup]");

    console.log("##[group]Install python dependencies");
    // After ncc bundling, __dirname is the task's dist/ directory; requirements.txt
    // is shipped one level up at the task root so the vsix carries it on the agent.
    const requirementsPath = path.join(__dirname, "..", "requirements.txt");
    await tl.exec("pip", ["install", "-r", requirementsPath]);
    console.log("Python dependencies installed");
    console.log("##[endgroup]");

    console.log("Python environment ready");
  } catch (err) {
    throw new Error(`Failed in common: ${err.message}`);
  }
}

module.exports = { run };
