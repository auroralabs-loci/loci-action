const tl = require("azure-pipelines-task-lib/task");

(async () => {
  try {
    const mode = tl.getInput("mode", true);
    if (mode === "summary") {
      tl.setResult(
        tl.TaskResult.Failed,
        "mode 'summary' is not yet supported on Azure DevOps. " +
        "View results in the LOCI Inspector dashboard via the link printed by mode 'upload'. " +
        "Summary mode is planned for a future release."
      );
      return;
    }
    if (mode !== "upload") {
      tl.setResult(
        tl.TaskResult.Failed,
        `Invalid mode '${mode}'. Must be 'upload'.`
      );
      return;
    }

    await require("./common").run();
    await require("./resolve").run();
    await require("./upload").run();
  } catch (err) {
    tl.setResult(tl.TaskResult.Failed, err.message);
  }
})();
