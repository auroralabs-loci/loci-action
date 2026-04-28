const tl = require("azure-pipelines-task-lib/task");

(async () => {
  try {
    const mode = tl.getInput("mode", true);
    if (mode !== "upload") {
      tl.setResult(
        tl.TaskResult.Failed,
        `Invalid mode '${mode}'. Must be 'upload'.`
      );
      return;
    }

    await require("./common").run();
    const resolved = await require("./resolve").run();
    await require("./upload").run(resolved);
  } catch (err) {
    tl.setResult(tl.TaskResult.Failed, err.message);
  }
})();
