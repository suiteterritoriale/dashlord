import dashlordConfig from "@/config.json";

export const smallUrl = (url: string): string =>
  url &&
  url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

export const slugifyUrl = (url: string): string => {
  return smallUrl(url).replace(/[\W_]+/g, "-");
};

export const getHostName = (url: string): string =>
  url
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/^([^/]+)\/.+$/, "$1");

export const getLastUrlSegment = (url: string): string =>
  url.substring(url.lastIndexOf("/") + 1);

export const sortByKey = (key: string) => (a: any, b: any) => {
  if (a[key] > b[key]) {
    return 1;
  }
  if (a[key] < b[key]) {
    return -1;
  }
  return 0;
};

export const isToolEnabled = (
  name: DashlordTool,
  url: string = null
): boolean => {
  if (!dashlordConfig.tools) return true;
  if (!dashlordConfig.urls) return true;
  let enabledGlobally = false;
  const hasTools = !!dashlordConfig.tools;
  // retro-compat array format
  if (hasTools) {
    if (Array.isArray(dashlordConfig.tools)) {
      enabledGlobally = dashlordConfig.tools.includes(name);
    } else {
      enabledGlobally = dashlordConfig.tools[name] === true;
    }
  }
  const urlConfig = dashlordConfig.urls.find((url2) => url2.url === url);
  const hasUrlTools =
    urlConfig && urlConfig.tools && urlConfig.tools[name] !== undefined;
  const disabledForUrl = hasUrlTools ? urlConfig.tools[name] === false : false;

  return enabledGlobally && !disabledForUrl;
};

export const letterGradeValue = (grade: string): number =>
  ({
    "A+": 200,
    A: 190,
    "A-": 180,
    "B+": 170,
    B: 160,
    "B-": 150,
    "C+": 140,
    C: 130,
    "C-": 120,
    "D+": 110,
    D: 100,
    "D-": 90,
    "E+": 80,
    E: 70,
    "E-": 60,
    "F+": 50,
    F: 40,
    "F-": 30,
  }[grade] || 0);

export const btoa = (b: any) => Buffer.from(b).toString("base64");

const lettersSeverities = {
  A: "success",
  B: "info",
  C: "warning",
  D: "warning",
  E: "error",
  F: "error",
  G: "error",
};
// python runtimes below 3.14.10 / 3.13.18 are flagged as warnings
export const pythonVersionTooOld = (version: string): boolean => {
  const m = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return false;
  const [major, minor, patch] = [+m[1], +m[2], m[3] ? +m[3] : 0];
  return (
    major < 3 ||
    (major === 3 && minor < 13) ||
    (major === 3 && minor === 13 && patch < 18) ||
    (major === 3 && minor === 14 && patch < 10)
  );
};

// single source of truth for the dependency status shown in the Dependencies
// tab and surfaced by the Deps column of the main dashboard: error if a
// dependency check fails, warning if at least one is in warning, green
// otherwise
export const dependencyStatus = (
  data: RepoChecksReport | null | undefined
): { status: "A" | "W" | "F"; title: string } | null => {
  if (!data) return null;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (data.frontend && !(data.ui_components || []).length)
    errors.push("no DSFR / UI package in the frontend");
  if ((data.ui_components || []).some((c) => /\/ui-kit$/.test(c.name)))
    warnings.push("deprecated @gouvfr-lasuite/ui-kit");
  const rt = data.backend && data.backend.runtime;
  if (rt && rt.language === "python" && pythonVersionTooOld(rt.version))
    warnings.push(`python ${rt.version} is below 3.14.10 / 3.13.18`);
  return {
    status: errors.length ? "F" : warnings.length ? "W" : "A",
    title: [...errors, ...warnings].join(" · ") || "All dependency checks OK",
  };
};

export const letterToSeverity = (letter: string) => {
  const firstLetter = letter.trim().substring(0, 1).toUpperCase();
  return lettersSeverities[firstLetter] || "info";
};
