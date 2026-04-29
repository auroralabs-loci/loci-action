const fs = require("fs");
const path = require("path");
const fg = require("fast-glob");
const tar = require("tar");
const utils = require("./utils");

const tl = require("azure-pipelines-task-lib/task");


async function writeRunSummary(details) {
  const summaryPath = path.join(process.cwd(), "loci-upload-summary.md");
  const md = [
    "# LOCI Upload Status",
    "",
    `${details.message} [${details.label}](${details.url})`,
    ""
  ].join("\n");
  fs.writeFileSync(summaryPath, md);
  tl.uploadSummary(summaryPath);
}

function isELFFile(file) {
  try {
    if (!fs.statSync(file).isFile()) {
      return false;
    }
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    return (
      buffer[0] === 0x7f &&
      buffer[1] === 0x45 && // 'E'
      buffer[2] === 0x4c && // 'L'
      buffer[3] === 0x46    // 'F'
    );
  } catch {
    return false;
  }
}

async function run({ target, base } = {}) {
  try {
    // target / base are resolved upstream by resolve.js and passed in by the
    // dispatcher; project / binaries / optimize are still task inputs the
    // customer set on the LociTask step.
    const iTarget = target;
    const iBase = base;
    const iProject = tl.getInput("project", true);
    const iBinaries = tl.getInput("binaries", true);
    const iOptimize = tl.getBoolInput("optimize", false);
    if (!iTarget) {
      throw new Error("target was not resolved by the resolve step.");
    }

    // loci_api 0.2.39 reads LOCI_SCM_TOKEN at module load and sends it as
    // X-SCM-Token. The backend's AzureProvider uses this token for the
    // Azure DevOps API calls it makes after the upload (PR comments, check
    // runs). System.AccessToken is the natural source on Azure Pipelines.
    const scmToken = tl.getVariable("System.AccessToken");
    if (scmToken) {
      process.env.LOCI_SCM_TOKEN = scmToken;
    }
    const isAgentic = await utils.isAgentic();
    const binaryEntries = iBinaries
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);

    console.log("##[group]Collect binaries");
    let binaries = new Set();
    for (const entry of binaryEntries) {
      if (!entry) {
        continue;
      }
      if (!fs.existsSync(entry)) {
        const matches = await fg(entry, { onlyFiles: true });
        if (!matches) {
          console.warning(`No binary found for entry: ${entry}, skipping...`);
          continue;
        }
        matches.filter(f => isELFFile(f)).forEach(f => binaries.add(f));
      } else {
        if (fs.statSync(entry).isDirectory()) {
          fs.readdirSync(entry).map(f => path.join(entry, f)).filter(f => isELFFile(f)).forEach(f => binaries.add(f));
        } else if (isELFFile(entry)) {
          binaries.add(entry);
        }
      }
    }

    binaries.forEach((file) => console.log(`- ${file}`));
    console.log("##[endgroup]");

    console.log("##[group]Archive binaries");
    const binsArchive = path.join(process.cwd(), "binaries.tar.gz");
    await tar.create({ gzip: true, file: binsArchive }, Array.from(binaries));
    const stats = fs.statSync(binsArchive);
    console.log(`Archive: ${binsArchive} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    console.log("Binaries archived");
    console.log("##[endgroup]");

    console.log("##[group]Upload version");
    console.log(`Project: ${iProject}`);
    console.log(`Target: ${iTarget}`);

    let loci_args = ["upload", binsArchive, iProject, iTarget, "--no-wait"];
    if (iBase) {
      console.log(`Base: ${iBase}`);
      if (iBase == iTarget) {
        tl.warning(`Base version equals head (${iBase}) — redundant analysis`);
      }
      loci_args.push("--compare-version-name", iBase);
    }

    if (utils.isPullRequest()) {
      const pullReq = utils.getPullRequestData();
      const scmMeta = pullReq.getSCMMetaData();
      loci_args.push("--scm-meta", JSON.stringify(scmMeta));
      if (iOptimize && isAgentic) {
        loci_args.push("--optimize");
      } else if (iOptimize && !isAgentic) {
        tl.warning("LOCI Code Agent optimization requested, but the provided company is not configured for agentic mode.");
      }
    }

    await tl.exec("loci_api", loci_args, { silent: false });
    console.log("Project version uploaded");
    console.log("##[endgroup]");

    const { s, m, details } = await utils.fetchVersionStatusWithDetails(iProject, iTarget, silent=false, allowInProgress=true);
    await writeRunSummary(details);
    console.log(`${details.message} ${details.label}: ${details.url}`);
  } catch (err) {
    throw new Error(`Upload failed: ${err.message}. Terminating analysis.`);
  }
}

module.exports = { run };
