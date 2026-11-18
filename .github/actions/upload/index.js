import fs from "fs";
import path from "path";
import fg from "fast-glob";
import * as utils from "../utils";

import * as core from "@actions/core";
import * as exec from "@actions/exec";

const OIDC_AUDIENCE = process.env.LOCI_OIDC_AUDIENCE || "loci-scm-proof";

async function getRepositoryProof() {
  try {
    const token = await core.getIDToken(OIDC_AUDIENCE);
    core.setSecret(token);
    return token;
  } catch (err) {
    const reason = String(err.message).split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
    core.warning(
      "LOCI could not prove this workflow runs in the PR's repository, so LOCI may skip its PR checks and comments. " +
      "Add `permissions: { id-token: write, contents: read }` to the job (pull requests from forks get no token). " +
      `(${reason})`
    );
    return "";
  }
}


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

async function collectBinaries(entries) {
  const binaries = new Set();

  for (const entry of entries) {
    if (!entry) continue;

    if (fs.existsSync(entry)) {
      const stat = fs.statSync(entry);

      if (stat.isFile()) {
        if (isELFFile(entry)) {
          binaries.add(entry);
        }
      } else if (stat.isDirectory()) {
        // Binaries are named after their archive member paths, so keep them relative as given, not absolute.
        const files = await fg("**/*", { cwd: entry, onlyFiles: true });
        for (const file of files.map((f) => path.join(entry, f))) {
          if (isELFFile(file)) {
            binaries.add(file);
          }
        }
      }
    } else {
      const matches = await fg(entry, { onlyFiles: true });
      if (matches.length === 0) {
        core.warning(`No files found for pattern: ${entry}, skipping...`);
        continue;
      }
      for (const file of matches) {
        if (isELFFile(file)) {
          binaries.add(file);
        }
      }
    }
  }

  return binaries;
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
    const binaries = await collectBinaries(binaryEntries);
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

    const env = { ...process.env };
    if (loci_args.includes("--scm-meta")) {
      const proof = await getRepositoryProof();
      if (proof) {
        env.LOCI_SCM_PROOF = proof;
      }
    }

    await utils.execLociApi(loci_args, { silent: false, env });
    core.info("Project version uploaded");
    core.endGroup();

    const { details } = await utils.fetchVersionStatusWithDetails(iProject, iTarget, false, true);
    await writeRunSummary(details);
  } catch (err) {
    core.setFailed(`Upload failed: ${err.message}. Terminating analysis.`);
  }
}

run();
