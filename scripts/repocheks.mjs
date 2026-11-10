#!/usr/bin/env node
// DashLord custom scanner "repocheks": analyzes GitHub repositories.
// Checks:
//   1. Runtime version (Python or Node) used by the backend Docker image
//   2. Distroless support in the backend Dockerfile
//   3. Caddy serving the frontend
//
// Usage:
//   node scripts/repocheks.mjs --url https://github.com/org/repo --output scans/repocheks.json
//   node scripts/repocheks.mjs --all [--results-dir results] [--dashlord-yml dashlord.yml]
//
// Output shape is versioned with the report UI (types/index.d.ts).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);

const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : undefined;
};

const repoFromUrl = (url) => {
  const m = url && url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/);
  return m ? `${m[1]}/${m[2].replace(/\.git$/, "")}` : null;
};

const cloneRepo = (repo, dir) =>
  execFileSync(
    "git",
    ["clone", "--depth", "1", `https://github.com/${repo}.git`, dir],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

const findDockerfiles = (root) => {
  const out = [];
  const skip = new Set([".git", "node_modules"]);
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) visit(p);
      else if (/^Dockerfile(\.\w+)?$|\.Dockerfile$/i.test(e.name))
        out.push(path.relative(root, p));
    }
  };
  visit(root);
  return out.sort();
};

// paths that never hold the production backend/frontend images or app
// package manifests (aux services: keycloak, mta, mocks, dev/test trees)
const EXCLUDE_RE =
  /(^|\/)(tests?|e2e|__[^/]*__|data|config|development|loadtest)(\/|$)|socks-proxy|scanner-|planka|swarm|canary|keycloak|mta|mock/i;
const BACKEND_NAME_RE = /mta|keycloak|rspamd|proxy|mail|scanner|caddy|e2e|mock/i;

const resolveArgs = (content) => {
  let out = content;
  const args = [...content.matchAll(/^ARG\s+(\w+)(?:=\s*"?([^"\s]+)"?)?\s*$/gm)];
  for (const [, name, value] of args) {
    if (value === undefined) continue;
    out = out.replaceAll(`\${${name}}`, value).replaceAll(`"${name}"`, `"${value}"`);
  }
  return out;
};

const baseImagesInfo = (files, read) => {
  const images = [];
  const seen = new Set();
  for (const f of files) {
    const lines = read(f)
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    const stageNames = new Set(
      [...lines.matchAll(/^FROM\s+.*?\s+AS\s+(\S+)\s*$/gm)].map((m) => m[1])
    );
    for (const m of lines.matchAll(
      /^FROM\s+(?:--platform=\S+\s+)?([^\s@]+)(@sha256:[0-9a-f]+)?(?:\s+AS\s+(\S+))?\s*$/gm
    )) {
      const [, image, digest, stage] = m;
      // scratch, ARG-referenced local build images and internal stage
      // references are not external base images
      if (image === "scratch" || image.startsWith("${")) continue;
      if (stageNames.has(image)) continue;
      const key = `${f}:${image}`;
      if (seen.has(key)) continue;
      seen.add(key);
      images.push({
        dockerfile: f,
        image,
        digest_pinned: Boolean(digest),
        stage: stage || null,
      });
    }
  }
  return { pinned: images.every((i) => i.digest_pinned), images };
};

const healthcheckInfo = (content) => ({
  present: /^HEALTHCHECK/m.test(content),
  count: (content.match(/^HEALTHCHECK/gm) || []).length,
});

const nonRootInfo = (content) => {
  if (/FROM\s+gcr\.io\/distroless\/\S*nonroot/.test(content))
    return { supported: true, evidence: "base distroless :nonroot" };
  const users = [...content.matchAll(/^USER\s+(\S+)/gm)].map((m) => m[1]);
  const nonRoot = users.filter((u) => !/^(root|0)(:|$)/.test(u));
  if (nonRoot.length)
    return { supported: true, evidence: `USER ${nonRoot[nonRoot.length - 1]}` };
  if (users.length)
    return { supported: false, evidence: `USER ${users[users.length - 1]}` };
  return { supported: false, evidence: null };
};

const distrolessInfo = (content) => {
  const images = [
    ...content.matchAll(
      /FROM\s+(gcr\.io\/distroless\/[^\s@]+)(@sha256:[0-9a-f]+)?(?:\s+AS\s+(\S+))?/g
    ),
  ].map((m) => ({
    image: m[1],
    digest_pinned: Boolean(m[2]),
    stage: m[3] || null,
  }));
  return { supported: images.length > 0, images };
};

const pythonScore = (file, content) => {
  if (EXCLUDE_RE.test(file) || BACKEND_NAME_RE.test(file)) return -1;
  let score = 0;
  if (/backend/i.test(file)) score += 3;
  if (/gunicorn|uvicorn|manage\.py runserver/.test(content)) score += 3;
  if (/FROM python:|uv python install|uv sync/.test(content)) score += 1;
  if (file === "Dockerfile") score += 1;
  return score;
};

const nodeScore = (file, content) => {
  if (EXCLUDE_RE.test(file) || BACKEND_NAME_RE.test(file)) return -1;
  let score = 0;
  if (/CMD \["node|npm run (start|dev|build)|\.\/start\.sh|yarn start|next start/.test(content))
    score += 3;
  if (/FROM node:/.test(content)) score += 2;
  if (/npm ci|yarn (install|build|dev)|dist\/(server|main)\.js/.test(content))
    score += 1;
  if (file === "Dockerfile") score += 1;
  return score;
};

const pickBackend = (dockerfiles, read) => {
  let bestPy = null;
  let bestNode = null;
  for (const f of dockerfiles) {
    const content = read(f);
    const py = pythonScore(f, content);
    const nd = nodeScore(f, content);
    if (py > ((bestPy && bestPy.score) || 0)) bestPy = { file: f, content, score: py };
    if (nd > ((bestNode && bestNode.score) || 0))
      bestNode = { file: f, content, score: nd };
  }
  // a decent python candidate is always the app backend (Django), even if a
  // node service scores higher (e.g. docs' yhub-server)
  if (bestPy && bestPy.score >= 3) return { ...bestPy, language: "python" };
  if (bestNode && bestNode.score >= 3) return { ...bestNode, language: "node" };
  const best = [bestPy, bestNode]
    .filter((c) => c && c.score >= 2)
    .sort((a, b) => b.score - a.score)[0];
  return best ? { ...best, language: best === bestPy ? "python" : "node" } : null;
};

const runtimeInfo = (backend, dockerfiles, read) => {
  const content = resolveArgs(backend.content);

  let m = content.match(/FROM\s+python:(\d+(?:\.\d+){1,2})/);
  if (m)
    return {
      language: "python",
      version: m[1],
      strategy: "python-base-image",
      source: backend.file,
    };

  m = content.match(/uv python install "?(\d+(?:\.\d+){1,2})"?/);
  if (m)
    return {
      language: "python",
      version: m[1],
      strategy: "uv-managed-python",
      source: backend.file,
    };

  m = content.match(/FROM\s+node:(\d+(?:\.\d+){0,2})/);
  if (m)
    return {
      language: "node",
      version: m[1],
      strategy: "node-base-image",
      source: backend.file,
    };

  // shared python base image referenced through an ARG (e.g. FROM ${PYTHON_UV_IMAGE})
  const versions = [];
  for (const f of dockerfiles) {
    if (f === backend.file || EXCLUDE_RE.test(f) || /(^|\/)\./.test(f)) continue;
    const mm = resolveArgs(read(f)).match(/uv python install "?(\d+(?:\.\d+){1,2})"?/);
    if (mm) versions.push({ version: mm[1], file: f });
  }
  if (!versions.length) return null;

  const uniq = [...new Set(versions.map((v) => v.version))];
  if (uniq.length === 1)
    return {
      language: "python",
      version: uniq[0],
      strategy: "shared-uv-base-image",
      source: versions[0].file,
    };

  for (const arg of [...backend.content.matchAll(/FROM\s+\$\{(\w+)\}/g)].map(
    (x) => x[1]
  )) {
    const def = backend.content.match(new RegExp(`ARG\\s+${arg}=(\\S+)`));
    if (!def) continue;
    const base = def[1].split(":")[0];
    const hit =
      versions.find((v) => v.file.includes(base)) ||
      versions.find((v) => v.file.includes(base.split("-").pop()));
    if (hit)
      return {
        language: "python",
        version: hit.version,
        strategy: "shared-uv-base-image",
        source: hit.file,
      };
  }
  return null;
};

const frontendInfo = (dockerfiles, read) => {
  let best = null;
  for (const f of dockerfiles) {
    if (EXCLUDE_RE.test(f) || !/frontend/i.test(f)) continue;
    const c = read(f);
    const caddy =
      /ENTRYPOINT\s*\[\s*"caddy"|caddy run --config|CADDY_VERSION|COPY.*Caddyfile/.test(
        c
      );
    const nginx = /nginx/i.test(c);
    const dl = distrolessInfo(c);
    const entrypoint = (c.match(/^ENTRYPOINT.*$/m) || [null])[0];
    // prefer canonical source trees over deployment variants (docker/, etc.)
    const score =
      (caddy ? 3 : 0) +
      (nginx ? 2 : 0) +
      (dl.supported ? 1 : 0) +
      (f.startsWith("src/") ? 1 : 0);
    if (score > ((best && best.score) || 0))
      best = {
        dockerfile: f,
        caddy,
        server: caddy ? "caddy" : nginx ? "nginx" : null,
        entrypoint,
        distroless: dl,
        monolith: false,
        score,
      };
  }
  if (best) {
    const { score, ...rest } = best;
    return rest;
  }
  return null;
};

const securityMdInfo = (root) => {
  for (const dir of [".", ".github", "docs"]) {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, dir));
    } catch {
      continue;
    }
    const hit = entries.find((e) => /^security\.md$/i.test(e));
    if (hit) return { present: true, path: path.posix.join(dir === "." ? "" : dir, hit) };
  }
  return { present: false, path: null };
};

const UI_PKG_RE = /ui-kit|ui-components|ui-tokens|cunningham|react-dsfr/i;

// python deps of interest, read from the backend's uv.lock (fallback:
// pyproject.toml dependency pins)
const PYTHON_DEPS = ["django", "django-lasuite"];

const pythonPackageManager = (backend, base, dir, read) => {
  const fromUv = (content) => {
    const resolved = resolveArgs(content);
    if (/ghcr\.io\/astral-sh\/uv/.test(resolved)) {
      const m = resolved.match(/ghcr\.io\/astral-sh\/uv[:@](\d[\w.]*)/);
      return { name: "uv", version: m ? m[1] : null };
    }
    return null;
  };
  if (backend) {
    const uv = fromUv(backend.content);
    if (uv) return uv;
  }
  // uv may live in a shared base image (e.g. messages' deploy/python-uv)
  for (const f of findDockerfiles(dir)) {
    if (backend && f === backend.file) continue;
    if (EXCLUDE_RE.test(f)) continue;
    const uv = fromUv(read(f));
    if (uv) return uv;
  }
  const b = base === "." ? "" : base;
  if (fs.existsSync(path.join(dir, path.posix.join(b, "poetry.lock"))))
    return { name: "poetry", version: null };
  const pyproject = path.posix.join(b, "pyproject.toml");
  if (
    fs.existsSync(path.join(dir, pyproject)) &&
    /\[tool\.poetry\]/.test(read(pyproject))
  )
    return { name: "poetry", version: null };
  if (
    fs
      .readdirSync(path.join(dir, b || "."))
      .some((f) => /^requirements.*\.txt$/.test(f))
  )
    return { name: "pip", version: null };
  if (backend && /pip install/.test(backend.content))
    return { name: "pip", version: null };
  return null;
};

const pythonDepsInfo = (dir, backend, read) => {
  const bases = backend
    ? [...new Set([path.dirname(backend.file), "src/backend", "."])]
    : ["src/backend", "."];
  for (const base of bases) {
    const lock = path.posix.join(base === "." ? "" : base, "uv.lock");
    if (fs.existsSync(path.join(dir, lock))) {
      const content = read(lock);
      const deps = {};
      for (const name of PYTHON_DEPS) {
        const m = content.match(
          new RegExp(`name = "${name}"\\s*\\nversion = "([^"]+)"`)
        );
        if (m) deps[name] = m[1];
      }
      deps.package_manager = pythonPackageManager(backend, base, dir, read);
      return deps;
    }
    const pyproject = path.posix.join(base === "." ? "" : base, "pyproject.toml");
    if (fs.existsSync(path.join(dir, pyproject))) {
      const content = read(pyproject);
      const deps = {};
      for (const name of PYTHON_DEPS) {
        const m = content.match(new RegExp(`"${name}[^"]*==([0-9][^"]*)"`, "i"));
        if (m) deps[name] = m[1];
      }
      deps.package_manager = pythonPackageManager(backend, base, dir, read);
      return deps;
    }
  }
  return null;
};

// node deps of interest + package manager, from the first app package.json
const NODE_DEPS = ["next", "typescript"];
const ROUTER_LIBS = [
  "@tanstack/react-router",
  "react-router-dom",
  "react-router",
  "wouter",
  "vue-router",
];
const LOCKFILES = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
};

const findPackageManager = (pkg, p, root) => {
  if (pkg?.packageManager && /^[a-z]+@/.test(pkg.packageManager)) {
    const [name, version] = pkg.packageManager.split("@");
    return { name, version };
  }
  // workspaces keep the lockfile at the monorepo root: walk up
  let folder = path.dirname(p);
  let lock = null;
  while (folder.startsWith(root)) {
    lock = Object.keys(LOCKFILES).find((f) =>
      fs.existsSync(path.join(folder, f))
    );
    if (lock || folder === root) break;
    folder = path.dirname(folder);
  }
  if (!lock) return null;
  if (lock === "yarn.lock") {
    const header = fs
      .readFileSync(path.join(folder, lock), "utf8")
      .split("\n")
      .slice(0, 3)
      .join("\n");
    const v = header.match(/yarn lockfile v(\d+)/);
    const rcPath = path.join(folder, ".yarnrc.yml");
    if (fs.existsSync(rcPath)) {
      const rc = fs.readFileSync(rcPath, "utf8");
      const y = rc.match(/yarn-[0-9.]+\.cjs/);
      if (y) return { name: "yarn", version: y[0].replace(/^yarn-/, "").replace(/\.cjs$/, "") };
    }
    return { name: "yarn", version: v ? v[1] : null };
  }
  return { name: LOCKFILES[lock], version: null };
};

const nodeDepsInfo = (root) => {
  let next = null;
  let typescript = null;
  let bundler = null;
  let router = null;
  let appPath = null;
  let appPkg = null;
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        visit(p);
        continue;
      }
      if (e.name !== "package.json") continue;
      const rel = path.relative(root, p);
      if (EXCLUDE_RE.test(rel)) continue;
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        continue;
      }
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next && next == null) {
        next = deps.next;
        appPath = p;
        appPkg = pkg;
        router = { name: "next", version: deps.next };
      }
      if (deps.typescript != null && typescript == null) {
        typescript = deps.typescript;
        if (!appPath) {
          appPath = p;
          appPkg = pkg;
        }
      }
      if (!bundler && (deps.vite || deps.webpack)) {
        bundler = deps.vite
          ? { name: "vite", version: deps.vite }
          : { name: "webpack", version: deps.webpack };
      }
      if (!router) {
        const lib = ROUTER_LIBS.find((r) => deps[r]);
        if (lib) router = { name: lib, version: deps[lib] };
      }
    }
  };
  visit(root);
  if (!appPath) return null;
  // Next.js embeds its own bundler: it wins over any vite/webpack dev tool
  if (next) bundler = { name: "next", version: next };
  return {
    next,
    typescript,
    bundler,
    router,
    package_manager: findPackageManager(appPkg, appPath, root),
  };
};

const uiComponentsInfo = (root) => {
  const out = [];
  const seen = new Set();
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        visit(p);
        continue;
      }
      if (e.name !== "package.json") continue;
      const rel = path.relative(root, p);
      if (EXCLUDE_RE.test(rel)) continue;
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        continue;
      }
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, spec] of Object.entries(deps || {})) {
        if (!UI_PKG_RE.test(name) || seen.has(name)) continue;
        seen.add(name);
        out.push({ name, spec, source: rel });
      }
    }
  };
  visit(root);
  return out.length ? out : null;
};

const analyze = (repo, url, dir) => {
  const dockerfiles = findDockerfiles(dir);
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

  const backend = pickBackend(dockerfiles, read);
  let backendInfo = null;
  let frontend = frontendInfo(dockerfiles, read);

  if (backend) {
    backendInfo = {
      dockerfile: backend.file,
      runtime: runtimeInfo(backend, dockerfiles, read),
      distroless: distrolessInfo(backend.content),
      healthcheck: healthcheckInfo(backend.content),
      runs_as_non_root: nonRootInfo(backend.content),
    };
    // node monolith: the app image serves the frontend itself, no separate
    // frontend server
    if (backend.language === "node" && !frontend) {
      const entrypoint =
        (backend.content.match(/^ENTRYPOINT.*$/m) || [null])[0] ||
        (backend.content.match(/^CMD.*$/m) || [null])[0];
      frontend = {
        dockerfile: backend.file,
        caddy: false,
        server: "node",
        entrypoint,
        distroless: null,
        monolith: true,
      };
    }
  }

  const baseImageFiles = [backend && backend.file, frontend && frontend.dockerfile]
    .filter(Boolean)
    .filter((f, i, a) => a.indexOf(f) === i);

  const baseImages =
    baseImageFiles.length && baseImagesInfo(baseImageFiles, read);

  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();

  return {
    repository: repo,
    url,
    branch,
    scan_date: new Date().toISOString(),
    error: null,
    security_md: securityMdInfo(dir),
    backend: backendInfo,
    frontend,
    ui_components: uiComponentsInfo(dir),
    dependencies: {
      python: pythonDepsInfo(dir, backend, read),
      node: nodeDepsInfo(dir),
    },
    base_images: baseImages || null,
  };
};

const releaseInfo = async (repo) => {
  try {
    const headers = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN)
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
    });
    if (!res.ok) return { tag: null, published_at: null, days: null };
    const data = await res.json();
    const published = data.published_at ? Date.parse(data.published_at) : null;
    return {
      tag: data.tag_name || null,
      published_at: data.published_at || null,
      days:
        published != null
          ? Math.floor((Date.now() - published) / 86400000)
          : null,
    };
  } catch {
    return { tag: null, published_at: null, days: null };
  }
};

const scanRepository = async (repo, url) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repocheks-"));
  try {
    cloneRepo(repo, dir);
    const result = analyze(repo, url, dir);
    result.release = await releaseInfo(repo);
    return result;
  } catch (e) {
    return {
      repository: repo,
      url,
      branch: null,
      scan_date: new Date().toISOString(),
      error: String(e.message || e).trim(),
      security_md: null,
      backend: null,
      frontend: null,
      ui_components: null,
      dependencies: null,
      base_images: null,
      release: null,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const printSummary = (results) => {
  for (const r of results) {
    console.log(`\n${r.repository} (${r.url})`);
    if (r.error) {
      console.log(`  ERROR: ${r.error}`);
      continue;
    }
    const rt = r.backend && r.backend.runtime;
    const dl = r.backend && r.backend.distroless;
    console.log(
      `  runtime: ${rt ? `${rt.language} ${rt.version} (${rt.strategy}, ${rt.source})` : "not found"}`
    );
    console.log(
      `  distroless backend: ${
        dl && dl.supported
          ? `yes (${dl.images.map((i) => i.stage || i.image).join(", ")})`
          : "no"
      }`
    );
    const hc = r.backend && r.backend.healthcheck;
    if (hc)
      console.log(
        `  healthcheck: ${hc.present ? `oui (${hc.count})` : "absent"}`
      );
    const nr = r.backend && r.backend.runs_as_non_root;
    if (nr)
      console.log(
        `  non-root: ${nr.supported ? `oui (${nr.evidence})` : "non"}`
      );
    const fe = r.frontend;
    console.log(
      `  frontend: ${
        fe
          ? fe.monolith
            ? `node monolith [${fe.dockerfile}]`
            : `${fe.server || "unknown"}${fe.distroless && fe.distroless.supported ? " (distroless)" : ""} [${fe.dockerfile}]`
          : "not found"
      }`
    );
    const rel = r.release;
    if (rel)
      console.log(
        `  last release: ${rel.tag ? `${rel.tag} (${rel.days}d ago)` : "none found"}`
      );
    const bi = r.base_images;
    if (bi)
      console.log(
        `  images épinglées: ${
          bi.pinned
            ? "oui"
            : `non (${bi.images.filter((i) => !i.digest_pinned).map((i) => i.image).join(", ")})`
        }`
      );
    const sec = r.security_md;
    if (sec)
      console.log(
        `  SECURITY.md: ${sec.present ? `present (${sec.path})` : "missing"}`
      );
    if (r.ui_components)
      console.log(
        `  ui: ${r.ui_components.map((c) => `${c.name} ${c.spec}`).join(", ")}`
      );
    const dep = r.dependencies;
    if (dep) {
      const py = dep.python || {};
      const nd = dep.node || {};
      const pm = nd.package_manager
        ? `${nd.package_manager.name}${nd.package_manager.version ? "@" + nd.package_manager.version : ""}`
        : "unknown";
      const pp = py.package_manager
        ? `${py.package_manager.name}${py.package_manager.version ? " " + py.package_manager.version : ""}`
        : "unknown";
      console.log(
        `  deps: django=${py.django || "-"} lasuite=${py["django-lasuite"] || "-"} py-pm=${pp} router=${nd.router ? `${nd.router.name} ${nd.router.version}` : "-"} ts=${nd.typescript || "-"} bundler=${nd.bundler ? `${nd.bundler.name} ${nd.bundler.version}` : "-"} pm=${pm}`
      );
    }
  }
};

const main = async () => {
  const targets = [];
  if (args.includes("--all")) {
    const ymlPath = getArg("dashlord-yml") || "dashlord.yml";
    const yml = fs.readFileSync(ymlPath, "utf8");
    for (const m of yml.matchAll(/^\s*-\s*url:\s*(\S+)/gm)) {
      targets.push({ url: m[1], repo: repoFromUrl(m[1]) });
    }
    if (!targets.length) throw new Error(`no urls found in ${ymlPath}`);
  } else {
    const url = getArg("url");
    const repo = getArg("repository") || repoFromUrl(url);
    if (!repo)
      throw new Error(
        "provide --repository org/repo or --url https://github.com/org/repo"
      );
    targets.push({ url: url || `https://github.com/${repo}`, repo });
  }

  const results = [];
  for (const t of targets) {
    console.error(`scanning ${t.repo}...`);
    results.push(await scanRepository(t.repo, t.url));
  }
  printSummary(results);

  const output = getArg("output");
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(results[0], null, 2));
  }
  const resultsDir = getArg("results-dir");
  if (resultsDir) {
    for (const r of results) {
      const b64 = Buffer.from(r.url).toString("base64");
      const dir = path.join(resultsDir, b64);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "repocheks.json"), JSON.stringify(r, null, 2));
    }
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
