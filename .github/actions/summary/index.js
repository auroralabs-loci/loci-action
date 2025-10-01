const fs = require("fs");
const path = require("path");
const utils = require("../utils");

const core = require("@actions/core");
const exec = require("@actions/exec");


function buildTables(insights, hasBaseVersion, topNSymbols) {
  if (!Array.isArray(insights)) throw new TypeError("Incorrect insights format");

  const binaries = new Map();
  for (const it of insights) {
    const key = it.binary_name ?? "__unknown__";
    if (!binaries.has(key)) binaries.set(key, []);
    binaries.get(key).push(it);
  }

  let result = [];
  for (const [binaryName, items] of binaries.entries()) {
    const data = items.map((it) => {
      const row = {
        binary_name: binaryName,
        function_name: it.function_name ?? "",
        // response
        rsp_mean: it.mean_response ?? "",
        ...(hasBaseVersion
          ? {
              rsp_base_mean: it.mean_response_base ?? "",
              rsp_perc: it.perc_response ?? "",
            }
          : {}),
        // throughput
        thr_mean: it.mean_throughput ?? "",
        ...(hasBaseVersion
          ? {
              thr_base_mean: it.mean_throughput_base ?? "",
              thr_perc: it.perc_throughput ?? "",
            }
          : {}),
        // bottleneck
        bn_mean: it.mean_bottleneck ?? "",
        ...(hasBaseVersion
          ? {
              bn_base_mean: it.mean_bottleneck_base ?? "",
              bn_perc: it.perc_bottleneck ?? "",
            }
          : {}),
      };
      return row;
    });

    result.push(...data);
  }

  result.sort((a, b) =>
    hasBaseVersion ? b.rsp_perc - a.rsp_perc : b.rsp_mean - a.rsp_mean
  );

  return result.slice(0, topNSymbols);
}

function formatTimeValue(nanoseconds) {
  if (nanoseconds < 1000) {
    return `${nanoseconds.toFixed(2)} ns`;
  } else if (nanoseconds < 1000000) {
    return `${(nanoseconds / 1000).toFixed(2)} μs`;
  } else if (nanoseconds < 1000000000) {
    return `${(nanoseconds / 1000000).toFixed(2)} ms`;
  } else {
    return `${(nanoseconds / 1000000000).toFixed(2)} s`;
  }
}

function numFormatter(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) {
    return String(v);
  }
  if (Number.isInteger(n)) {
    return formatTimeValue(n);
  }
  return formatTimeValue(Number(n));
}

function percFormatter(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) {
    return String(v);
  }
  return `${n.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function toSummaryTable(data, columns) {
  if (!data || !data.length) {
    return [[{ data: "No symbols found", header: true }]];
  }
  const header = columns.map((c) => ({ data: c.header, header: true }));
  const body = data.map((r) =>
    columns.map((c) => {
      const raw = r[c.key];
      if (c.formatter) {
        return c.formatter(raw);
      }
      return String(raw ?? "");
    })
  );
  return [header, ...body];
}

function getColumns(hasBaseVersion) {
  let columns = [
    { header: "Binary", key: "binary_name" },
    { header: "Function", key: "function_name" },
    { header: "Response mean", key: "rsp_mean", formatter: numFormatter },
    { header: "Throughput mean", key: "thr_mean", formatter: numFormatter },
    { header: "Bottleneck mean", key: "bn_mean", formatter: numFormatter },
  ];

  if (!hasBaseVersion) {
    return columns;
  }

  columns.splice(
    3,0,
    { header: "Response base mean", key: "rsp_base_mean", formatter: numFormatter },
    { header: "Response %", key: "rsp_perc", formatter: percFormatter }
  );
  columns.splice(
    6,0,
    { header: "Throughput base mean", key: "thr_base_mean", formatter: numFormatter },
    { header: "Throughput %", key: "thr_perc", formatter: percFormatter }
  );
  columns.splice(
    10, 0,
    { header: "Bottleneck base mean", key: "bn_base_mean", formatter: numFormatter },
    { header: "Bottleneck %", key: "bn_perc", formatter: percFormatter }
  );
  return columns;
}

async function writeRunSummary(details, summary, diffSummary, insights, hasBaseVersion, topNSymbols) {
  const table = buildTables(insights, hasBaseVersion, topNSymbols);
  core.summary
    .addHeading("LOCI Summary", 1)
    .addRaw(summary || "");

  const hasDiffSummary = diffSummary && Object.keys(diffSummary).length;

  core.summary
  .addHeading("Execution Metrics", 3);

  if (table && table.length) {
    if (hasBaseVersion && hasDiffSummary) {
      core.summary
      .addRaw(`Modified symbols count: ${insights.length} (showing top ${topNSymbols})`)
      .addBreak()
      .addEOL();
    } else {
      core.summary
      .addRaw(`Symbols count: ${insights.length} (showing top ${topNSymbols})`)
      .addBreak()
      .addEOL();
    }

    core.summary
      .addTable(toSummaryTable(table, getColumns(hasBaseVersion)));
  } else if (hasBaseVersion) {
    core.summary.addRaw("No modified symbols detected.");
  } else {
    core.summary.addRaw("No symbols detected.");
  }
  
  if (hasBaseVersion && hasDiffSummary) {
    core.summary
    .addHeading("Diff Overview", 2);

    const message = `* ${diffSummary.modified} modified | + ${diffSummary.new} added | − ${diffSummary.deleted} deleted functions`;
    core.info(message);
    core.summary
      .addRaw(message)
      .addHeading("What counts as a change?", 4)
      .addRaw("Function modifications may result from different factors (not always direct source code edits), such as:")
      .addList([
        "Compiler optimizations",
        "Instruction reordering",
        "Assembly generation"
      ]);
  } else if (hasBaseVersion) {
    warnMessage = "No comparison analysis found between the selected base and target versions. Information about symbol changes (modified, deleted, etc.) is missing from the report.";
    core.warning(warnMessage);
    core.summary
    .addRaw(`* ${warnMessage}`);
  }

  core.info(`${details.message} ${details.label}: ${details.url}`);

  core.summary
    .addEOL()
    .addRaw(`${details.message} `)
    .addLink(details.label, details.url)
    .addEOL()
    .addRaw("Performance thresholds are enforced in the __LOCI Performance__ check.")
    .write({ overwrite: true });
}

async function fetchAgentSummary(project, target, base, scmMeta) {
  const output = path.join(process.cwd(), "summary.json");

  let loci_args = [
    "summary",
    project,
    target,
    base,
    "--scm-meta",
    JSON.stringify(scmMeta),
    "--output",
    output,
  ];

  try {

    let lapi_out = '';
    let lapi_err = '';

    await exec.exec("loci_api", loci_args, {
      silent: false,
      env: process.env,
      listeners: {
        stdout: (data) => {
          lapi_out += data.toString();
        },
        stderr: (data) => {
          lapi_err += data.toString();
        }
      }
    });

    // console.debug('LOCI.API [stdout]:', lapi_out);
    // console.debug('LOCI.API [stderr]:', lapi_err);

    const summary = JSON.parse(fs.readFileSync(output, "utf8"));
    if (!summary) {
      core.warning("No summary found");
      return "";
    }

    if (summary) {
      const lines = summary.trim().split("\n");
      if (lines.length == 0) {
        return "";
      }
      let fl = lines[0];
      fl = fl.replaceAll('#', '');
      return `\n_${fl.trim()}_\n${lines.slice(1).join("\n")}`;
    }

    return "";
  } catch (err) {
    core.warning(`Failed to fetch agent summary: ${err.message}`);
  }
  return "";
}

async function waitVersionProcessingToFinish(
  project, 
  target,
  {
    initialDelay = 30_000,
    factor = 1.7,
    maxDelay = 60_000
  } = {}
) {
  let base = initialDelay;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let logWaitMessage = true;

  while (true) {
    const { status, details } = await utils.fetchVersionStatusWithDetails(project, target);
    if (status !== -1 ) {
      return {status, details };
    }

    if (logWaitMessage) {
      logWaitMessage = false;
      core.info('Waiting for binaries processing to finish. This may take a moment...');
    }

    base = Math.min(maxDelay, Math.round(base * factor));
    const delay = Math.floor(Math.random() * base);
    await sleep(delay);
  }
}

async function run() {
  try {
    const iProject = core.getInput("project", { required: true });
    const iTarget  = core.getInput("target", { required: true });
    const iBase = core.getInput("base", { required: false });
    const iTopNSymbols = core.getInput("top-n-symbols", { required: true });

    const { status, details } = await waitVersionProcessingToFinish(iProject, iTarget);
    if (status !== 0) {
      throw new Error(`Processing of target version '${iTarget}' is unavailable.`)
    }
    core.info('Binaries processed successfully.');

    core.startGroup("Fetch function insights");
    core.info(`Project: ${iProject}`);
    core.info(`Head: ${iTarget}`);

    const insightsFile = path.join(process.cwd(), "data.json");
    let loci_args = ["func-insights", iProject, iTarget, "--output", insightsFile];
    
    if (iBase) {
      core.info(`Base: ${iBase}`);
      if (iBase == iTarget) {
        core.warning(`Base version equals head (${iBase}) — analysis may be uninformative.`);
      }
      loci_args.push("--version-name-base", iBase, "--filter", "mod");
    }

    await exec.exec("loci_api", loci_args, { silent: false });
    const data = JSON.parse(fs.readFileSync(insightsFile, "utf8"));
    const diffSummary = data.diff_summary;
    const insights = data.insights;
    core.info("Insights fetched successfully.");
    core.endGroup();

    core.startGroup("Fetch AI summary");
    let summary = null;
    if (iBase && utils.isPullRequest()) {
      const pullReq = utils.getPullRequestData();
      if (pullReq) {
        const scmMeta = pullReq.getSCMMetaData();
        summary = await fetchAgentSummary(iProject, iTarget, iBase, scmMeta);
        if (summary) {
          const details_message = `${details.message} [${details.label}](${details.url}).`;
          core.setOutput("loci_summary", `${summary}\n${details_message}`);
          core.info("AI summary report fetched successfully");
        }
      } else {
        core.warning("AI agent summary is not available outside of a pull request context.");
      }
    }
    core.endGroup();

    await writeRunSummary(details, summary, diffSummary, insights, !!iBase, iTopNSymbols);
  } catch (err) {
    core.setFailed(`Insights failed: ${err.message}. Terminating analysis.`);
  }
}

run();
