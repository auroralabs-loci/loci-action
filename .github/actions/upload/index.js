const fs = require("fs");
const path = require("path");
const fg = require("fast-glob");
const utils = require("../utils");

const core = require("@actions/core");
const exec = require("@actions/exec");
const github = require("@actions/github");


async function writeRunSummary(details) {
  core.summary
    .addHeading("LOCI Upload Status", 1)
    .addRaw(`${details.message} `)
    .addLink(details.label, details.url)
    .addEOL()
    .write();
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

async function run() {
  try {
    const iBase = core.getInput("base", { required: false });
    const iTarget = core.getInput("target", { required: true });
    const iProject = core.getInput("project", { required: true });
    const iBinaries = core.getInput("binaries", { required: true });
    const binaryEntries = iBinaries
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    core.startGroup("Collect binaries");
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
        binaries.add(...matches.filter(f => isELFFile(f)));
      } else {
        if (fs.statSync(entry).isDirectory()) {
          binaries.add(...fs.readdirSync(entry).map(f => path.join(entry, f)).filter(f => isELFFile(f)));
        } else if (isELFFile(entry)) {
          binaries.add(entry);
        }
      }
    }

    binaries.forEach((file) => core.info(`- ${file}`));
    core.endGroup();

    core.startGroup("Archive binaries");
    const binsArchive = path.join(process.cwd(), "binaries.tar.gz");
    await exec.exec("tar", ["-zcf", binsArchive, ...binaries]);
    await exec.exec("ls", ["-lh", binsArchive]);
    core.info("Binaries archived");
    core.endGroup();

    core.startGroup("Upload version");
    core.info(`Project: ${iProject}`);
    core.info(`Target: ${iTarget}`);

    let loci_args = ["upload", binsArchive, iProject, iTarget, "--no-wait"];
    if (iBase) {
      core.info(`Base: ${iBase}`);
      if (iBase == iTarget) {
        core.warning(`Base version equals head (${iBase}) — redundant analysis`);
      }
      loci_args.push("--compare-version-name", iBase);
    }

    if (utils.isPullRequest()) {
      const pullReq = utils.getPullRequestData();
      const scmMeta = pullReq.getSCMMetaData();
      loci_args.push("--scm-meta", JSON.stringify(scmMeta));
    }

    await exec.exec("loci_api", loci_args, { silent: false });
    core.info("Project version uploaded");
    core.endGroup();

    const { s, m, details } = await utils.fetchVersionStatusWithDetails(iProject, iTarget, silent=false, allowInProgress=true);
    await writeRunSummary(details);
  } catch (err) {
    core.setFailed(`Upload failed: ${err.message}. Terminating analysis.`);
  }
}

run();
