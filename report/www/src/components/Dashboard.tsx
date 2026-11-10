import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";

import Badge from "@codegouvfr/react-dsfr/Badge";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { fr } from "@codegouvfr/react-dsfr";

import uniq from "lodash.uniq";

import {
  isToolEnabled,
  smallUrl,
  slugifyUrl,
  getLastUrlSegment,
  sortByKey,
  dependencyStatus,
} from "../utils";
import { getLatestPhase, phaseSeverities } from "./BetagouvInfo";
import { GradeBadge, IconUnknown } from "./GradeBadge";
import dashlordConfig from "@/config.json";

type DashboardProps = { report: DashLordReport };

export const Dashboard: React.FC<DashboardProps> = ({ report }) => {
  const defaultColumnsProps = {
    sortable: true,
    width: 120,
    type: "string",
    headerAlign: "center" as const,
    align: "center" as const,
  };

  let columns: GridColDef[] = [
    {
      ...defaultColumnsProps,
      field: "url",
      headerAlign: "left",
      align: "left",
      headerName: `Repository ${report && `(${report.length})`}`,
      width: 220,
      renderCell: (params) => (
        <div
          style={{
            width: "95%",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          <Link
            prefetch={false}
            title={`View details for ${getLastUrlSegment(params.value) || smallUrl(params.value)}`}
            href={`/url/${encodeURIComponent(slugifyUrl(params.value))}`}
          >
            <i className={fr.cx("fr-icon-search-line", "fr-icon--sm")} />
            &nbsp;
            {getLastUrlSegment(params.value) || smallUrl(params.value)}
          </Link>
        </div>
      ),
    },
  ];

  const isColumnEnabled = (tool: DashlordTool) => {
    const isColumnDisabled =
      dashlordConfig.columns &&
      typeof dashlordConfig.columns[tool] !== "undefined"
        ? dashlordConfig.columns[tool] === false
        : false;
    return isToolEnabled(tool) && !isColumnDisabled;
  };


  if (isColumnEnabled("repocheks")) {
    const getRepocheks = (row: UrlReport) => row.repocheks || null;

    // dependency summary column, right after the repository name
    columns.push({
      ...defaultColumnsProps,
      field: "repocheks-deps",
      headerName: `Deps`,
      description:
        "Dependency health: error if a dependency check fails, warning if at least one is in warning (deprecated ui-kit, python runtime below 3.14.10 / 3.13.18)",
      width: 90,
      valueGetter: (params) => {
        const s = dependencyStatus(getRepocheks(params.row as UrlReport));
        return s ? s.status : "";
      },
      renderCell: (params) => {
        const s = dependencyStatus(getRepocheks(params.row as UrlReport));
        if (!s) return <IconUnknown />;
        return (
          <GradeBadge
            label={s.status}
            severity={
              s.status === "A"
                ? "success"
                : s.status === "W"
                  ? "warning"
                  : "error"
            }
            showCheckOnSuccess
            title={s.title}
            linkProps={{
              href: `/url/${slugifyUrl(params.row.url)}/dependencies/`,
            }}
          />
        );
      },
    });

    // days since the last GitHub release
    columns.push({
      ...defaultColumnsProps,
      field: "repocheks-release",
      headerName: `Release`,
      description: "Days since the last GitHub release",
      width: 100,
      type: "number",
      valueGetter: (params) => {
        const d = getRepocheks(params.row as UrlReport);
        return d && d.release ? d.release.days ?? -1 : -1;
      },
      renderCell: (params) => {
        const d = getRepocheks(params.row as UrlReport);
        const release = d && d.release;
        if (!release) return <IconUnknown />;
        if (release.days == null)
          return (
            <span style={{ color: "var(--text-mention-grey)" }}>–</span>
          );
        return (
          <GradeBadge
            label={`${release.days}d`}
            severity={
              release.days <= 60
                ? "success"
                : release.days <= 120
                  ? "warning"
                  : "error"
            }
            title={`${release.tag} published on ${release.published_at}`}
            linkProps={{
              href: `https://github.com/${d.repository}/releases`,
            }}
          />
        );
      },
    });
    columns.push(
      {
        ...defaultColumnsProps,
        field: "repocheks-distroless",
        headerName: `Distroless`,
        description:
          "Does the backend Dockerfile provide a distroless runtime?",
        width: 110,
        valueGetter: (params) => {
          const d = getRepocheks(params.row);
          const supported =
            d && d.backend && d.backend.distroless && d.backend.distroless.supported;
          return supported ? "A" : d && d.backend ? "F" : "";
        },
        renderCell: (params) => {
          const d = getRepocheks(params.row);
          if (!d || !d.backend) return <IconUnknown />;
          const distroless = d.backend.distroless;
          const supported = distroless && distroless.supported;
          const details = `Distroless stage(s): ${distroless.images
            .map((i) => `${i.stage || "?"} (${i.image})`)
            .join(", ")}`;
          return (
            <GradeBadge
              label={supported ? "A" : "F"}
              severity={supported ? "success" : "error"}
              showCheckOnSuccess
              title={
                supported
                  ? details
                  : "No distroless stage found in the backend Dockerfile"
              }
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/best-practices/#repocheks`,
              }}
            />
          );
        },
      },
      {
        ...defaultColumnsProps,
        field: "repocheks-nonroot",
        headerName: `Non-root`,
        description:
          "Does the backend image run as a non-root user?",
        width: 110,
        valueGetter: (params) => {
          const d = getRepocheks(params.row);
          return d && d.backend && d.backend.runs_as_non_root
            ? d.backend.runs_as_non_root.supported
              ? "A"
              : "F"
            : "";
        },
        renderCell: (params) => {
          const d = getRepocheks(params.row);
          const nr = d && d.backend && d.backend.runs_as_non_root;
          if (!nr) return <IconUnknown />;
          return (
            <GradeBadge
              label={nr.supported ? "A" : "F"}
              severity={nr.supported ? "success" : "error"}
              showCheckOnSuccess
              title={
                nr.supported
                  ? `Runs as non-root (${nr.evidence || "detected"})`
                  : "The backend image runs as root (no non-root USER instruction and no distroless :nonroot base)"
              }
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/best-practices/#repocheks`,
              }}
            />
          );
        },
      },
      {
        ...defaultColumnsProps,
        field: "repocheks-healthcheck",
        headerName: `Healthcheck`,
        description:
          "Does the backend Dockerfile define a HEALTHCHECK instruction?",
        width: 110,
        valueGetter: (params) => {
          const d = getRepocheks(params.row);
          return d && d.backend && d.backend.healthcheck
            ? d.backend.healthcheck.present
              ? "A"
              : "F"
            : "";
        },
        renderCell: (params) => {
          const d = getRepocheks(params.row);
          const hc = d && d.backend && d.backend.healthcheck;
          if (!hc) return <IconUnknown />;
          return (
            <GradeBadge
              label={hc.present ? "A" : "F"}
              severity={hc.present ? "success" : "error"}
              showCheckOnSuccess
              title={
                hc.present
                  ? `${hc.count} HEALTHCHECK instruction(s)`
                  : "No HEALTHCHECK instruction in the backend Dockerfile"
              }
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/best-practices/#repocheks`,
              }}
            />
          );
        },
      },
      {
        ...defaultColumnsProps,
        field: "repocheks-caddy",
        headerName: `Caddy`,
        description: "Is the frontend served by Caddy?",
        width: 110,
        valueGetter: (params) => {
          const d = getRepocheks(params.row);
          if (!d || !d.frontend) return "";
          return d.frontend.caddy ? "A" : d.frontend.monolith ? "mono" : "F";
        },
        renderCell: (params) => {
          const d = getRepocheks(params.row);
          if (!d || !d.frontend) return <IconUnknown />;
          if (d.frontend.monolith)
            return (
              <GradeBadge
                label="mono"
                severity="info"
                title="Monolithic app: the Node backend serves the frontend directly, no separate frontend server"
                linkProps={{
                  href: `/url/${slugifyUrl(params.row.url)}/best-practices/#repocheks`,
                }}
              />
            );
          return (
            <GradeBadge
              label={d.frontend.caddy ? "A" : "F"}
              severity={d.frontend.caddy ? "success" : "error"}
              showCheckOnSuccess
              title={
                d.frontend.caddy
                  ? "Frontend served by Caddy"
                  : `The frontend is served by ${d.frontend.server || "another server"}`
              }
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/best-practices/#repocheks`,
              }}
            />
          );
        },
      },
      {
        ...defaultColumnsProps,
        field: "repocheks-pinned",
        headerName: `Pinned`,
        description:
          "Are all external base images in the Dockerfiles pinned by digest (@sha256)?",
        width: 110,
        valueGetter: (params) => {
          const d = getRepocheks(params.row);
          return d && d.base_images ? (d.base_images.pinned ? "A" : "F") : "";
        },
        renderCell: (params) => {
          const d = getRepocheks(params.row);
          if (!d || !d.base_images) return <IconUnknown />;
          const pinned = d.base_images.pinned;
          const unpinned = d.base_images.images.filter((i) => !i.digest_pinned);
          return (
            <GradeBadge
              label={pinned ? "A" : "F"}
              severity={pinned ? "success" : "error"}
              showCheckOnSuccess
              title={
                pinned
                  ? `${d.base_images.images.length} base image(s), all pinned by digest`
                  : `${unpinned.length} unpinned image(s): ${unpinned
                      .map((i) => i.image)
                      .join(", ")}`
              }
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/best-practices/#repocheks`,
              }}
            />
          );
        },
      },
      {
        ...defaultColumnsProps,
        field: "repocheks-security",
        headerName: `Security`,
        description:
          "Does the repository contain a SECURITY.md file (root, .github/ or docs/)?",
        width: 110,
        valueGetter: (params) => {
          const d = getRepocheks(params.row);
          return d && d.security_md ? (d.security_md.present ? "A" : "F") : "";
        },
        renderCell: (params) => {
          const d = getRepocheks(params.row);
          if (!d || !d.security_md) return <IconUnknown />;
          const present = d.security_md.present;
          return (
            <GradeBadge
              label={present ? "A" : "F"}
              severity={present ? "success" : "error"}
              showCheckOnSuccess
              title={
                present
                  ? `SECURITY.md present (${d.security_md.path})`
                  : "No SECURITY.md found at the root, in .github/ or docs/"
              }
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/best-practices/#repocheks`,
              }}
            />
          );
        },
      }
    );
  }

  if (isColumnEnabled("betagouv")) {
    columns.push({
      ...defaultColumnsProps,
      field: "beta-phase",
      headerName: `Phase`,
      width: 250,
      valueGetter: (params) => {
        return (
          (params.row.betagouv &&
            getLatestPhase(params.row.betagouv.attributes.phases).index) ||
          ""
        );
      },
      renderCell: (params) => {
        if (!isToolEnabled("betagouv", params.row.url)) return <IconUnknown />;
        const latestPhase =
          params.row.betagouv &&
          getLatestPhase(params.row.betagouv.attributes.phases);
        if (latestPhase) {
          return (
            <Badge
              severity={
                phaseSeverities[latestPhase.label.toLowerCase()] || "info"
              }
              noIcon
            >
              {latestPhase.label}
            </Badge>
          );
        } else {
          return <IconUnknown />;
        }
      },
    });

    if (isColumnEnabled("declaration-a11y")) {
      columns.push({
        ...defaultColumnsProps,
        field: "declaration-a11y",
        headerName: `Déclaration d'accessibilité`,
        description:
          "Présence de la mention de conformité et de la déclaration",
        width: 150,
        valueGetter: (params) => {
          return params.row.summary["declaration-a11y"] || "";
        },
        renderCell: (params) => {
          if (!isToolEnabled("declaration-a11y", params.row.url))
            return <IconUnknown />;
          const grade = params.row.summary["declaration-a11y"];
          const severity = grade === "A" ? "success" : "error"

          if (grade) {
            return (
              <GradeBadge
                title={`Voir les détails de la déclaration d'accessibiilité pour l'url ${slugifyUrl(
                  params.row.url
                )}`}
                label={grade}
                hideLabelOnWarning
                severity={severity}
                showCheckOnSuccess
                linkProps={{
                  href: `/url/${slugifyUrl(
                    params.row.url
                  )}/best-practices/#declaration-a11y`,
                }}
              />
            );
          }
          return <IconUnknown />;
        },
      });
    }
  }

  if (isColumnEnabled("lighthouse")) {
    columns = columns.concat([
      {
        ...defaultColumnsProps,
        field: "accessibility",
        type: "number",
        headerName: `Tests auto accessibilité`,
        description:
          "Bonnes pratiques en matière d'accessibilité web...... ⚠️ Ne couvre que ~20% des critères du RGAA",
        width: 150,
        valueGetter: (params) => {
          return params.row.summary.lighthouse_accessibility || 0;
        },
        renderCell: (params) => {
          if (!isToolEnabled("lighthouse", params.row.url))
            return <IconUnknown />;
          const value = params.row.summary[`lighthouse_accessibility`];
          if (!value) return <IconUnknown />;

          const grade = (value >= 1) ? "A" : "F";
          const severity =  (value >= 1) ? "success" : "error";

          return (
            <GradeBadge
              title={`Voir les détails lighthouse pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              severity={severity}
              label={grade}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#lighthouse`,
              }}
            />
          );
        },
      },
      {
        ...defaultColumnsProps,
        field: "performance",
        type: "number",
        headerName: `WebPerf`,
        description: "Performances de chargement des pages web (LightHouse)",
        valueGetter: (params) => {
          return params.row.summary.lighthouse_performance;
        },
        renderCell: (params) => {
          if (!isToolEnabled("lighthouse", params.row.url))
            return <IconUnknown />;
          return (
            <GradeBadge
              showCheckOnSuccess
              title={`Voir les détails lighthouse pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              label={params.row.summary["lighthouse_performanceGrade"]}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#lighthouse`,
              }}
            />
          );
        },
      },
      {
        ...defaultColumnsProps,
        field: "seo",
        type: "number",
        headerName: `SEO`,
        description:
          "Bonnes pratiques en matière de référencement naturel (LightHouse)",
        valueGetter: (params) => {
          return params.row.summary.lighthouse_seo || 0;
        },
        renderCell: (params) => {
          if (!isToolEnabled("lighthouse", params.row.url))
            return <IconUnknown />;
          return (
            <GradeBadge
              showCheckOnSuccess
              title={`Voir les détails lighthouse pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              label={params.row.summary["lighthouse_seoGrade"]}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#lighthouse`,
              }}
            />
          );
        },
      },
    ]);
  }

  if (isColumnEnabled("github_repository")) {
    columns.push({
      ...defaultColumnsProps,
      field: "github_repository",
      headerName: `OpenSource`,
      width: 110,
      valueGetter: (params) => {
        return params.row.summary.githubRepositoryGrade || "";
      },
      renderCell: (params) => {
        if (!isToolEnabled("github_repository", params.row.url))
          return <IconUnknown />;

        const grade = params.value;
        if (grade) {
          return <GradeBadge showCheckOnSuccess label={grade} />;
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("declaration-rgpd")) {
    columns.push({
      ...defaultColumnsProps,
      field: "declaration-rgpd-ml",
      headerName: `Mentions légales`,
      description: "Présence des mentions légales et conformité de celles-ci",
      width: 150,
      valueGetter: (params) => {
        return params.row.summary["declaration-rgpd-ml"] || "";
      },
      renderCell: (params) => {
        if (!isToolEnabled("declaration-rgpd", params.row.url))
          return <IconUnknown />;

        const grade = params.value;
        const warning =
          params.row.summary["declaration-rgpd-ml"] === "D"
            ? "Les mentions légales sont présentes mais incomplètes. Consultez les détails pour plus d'informations"
            : params.row.summary["declaration-rgpd-ml"] === "F"
            ? "Les mentions légales n'ont pas été détectées"
            : null;
        if (grade) {
          return (
            <GradeBadge
              showCheckOnSuccess
              hideLabelOnWarning
              label={grade}
              warning={warning}
              title={`Voir les détails de la conformité juridique pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#declaration-rgpd`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });

    columns.push({
      ...defaultColumnsProps,
      field: "declaration-rgpd-pc",
      headerName: `Politique de confidentialité`,
      description:
        "Présence de la politique de confidentialité et conformité de celle-ci",
      width: 150,
      valueGetter: (params) => {
        return params.row.summary["declaration-rgpd-pc"] || "";
      },
      renderCell: (params) => {
        if (!isToolEnabled("declaration-rgpd", params.row.url))
          return <IconUnknown />;
        const grade = params.value;
        const warning =
          params.row.summary["declaration-rgpd-pc"] === "D"
            ? "La politique de confidentialité est présente mais incomplète. Consultez les détails pour plus d'informations"
            : params.row.summary["declaration-rgpd-pc"] === "F"
            ? "La politique de confidentialité n'a pas été trouvée"
            : null;
        if (grade) {
          return (
            <GradeBadge
              showCheckOnSuccess
              hideLabelOnWarning
              label={grade}
              warning={warning}
              title={`Voir les détails de la conformité juridique pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#declaration-rgpd`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("dsfr")) {
    columns.push({
      ...defaultColumnsProps,
      field: "dsfr",
      width: 80,
      headerName: `DSFR`,
      valueGetter: (params) => {
        return params.row.summary.dsfrGrade || "";
      },
      renderCell: (params) => {
        if (!isToolEnabled("dsfr", params.row.url)) return <IconUnknown />;
        const grade = params.value;
        if (grade) {
          return (
            <GradeBadge
              showCheckOnSuccess
              label={grade}
              title={`Voir les détails de la détection du design système de l'état pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/best-practices/#dsfr`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("ecoindex")) {
    columns.push({
      ...defaultColumnsProps,
      field: "ecoindex",
      headerName: `Eco-index`,
      valueGetter: (params) => {
        return params.row.summary.ecoindexGrade || "";
      },
      renderCell: (params) => {
        if (!isToolEnabled("ecoindex", params.row.url)) return <IconUnknown />;
        const grade = params.value;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir les détails de l'éco-index pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={grade}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#ecoindex`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("testssl")) {
    columns.push({
      ...defaultColumnsProps,
      field: "testssl",
      headerName: `SSL`,
      type: "string",
      valueGetter: (params) => {
        let grade = params.row.summary.testsslGrade;
        if (
          params.row.summary.testsslExpireSoon &&
          params.row.summary.testsslExpireDate
        ) {
          grade = "F";
        }
        return grade;
      },
      renderCell: (params) => {
        if (!isToolEnabled("testssl", params.row.url)) return <IconUnknown />;
        const grade = params.value;
        let warning;
        if (
          params.row.summary.testsslExpireSoon &&
          params.row.summary.testsslExpireDate
        ) {
          warning = `Expire le : ${format(
            new Date(params.row.summary.testsslExpireDate),
            "dd/MM/yyyy"
          )}`;
        }
        if (grade) {
          return (
            <GradeBadge
              title={`Voir les détails du test SSL pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              hideLabelOnWarning
              label={grade}
              warning={warning}
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/securite/#testssl`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("http")) {
    columns.push({
      ...defaultColumnsProps,
      field: "http",
      width: 80,
      headerName: `HTTP`,
      description:
        "Bonnes pratiques de configuration HTTP (Mozilla observatory)",
      type: "string",
      valueGetter: (params) => {
        return (
          params.row.summary.httpGrade &&
          params.row.summary.httpGrade.substring(0, 1)
        );
      },
      renderCell: (params) => {
        if (!isToolEnabled("http", params.row.url)) return <IconUnknown />;
        const grade = params.value;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir les détails Mozilla HTTP Obervatory pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={grade}
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/securite/#http`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("updownio")) {
    columns.push({
      ...defaultColumnsProps,
      field: "updownio",
      headerName: `Disponibilité`,
      description: "Disponibilité du service (updown.io)",
      type: "number",
      valueGetter: (params) => {
        return params.row.summary.uptime;
      },
      renderCell: (params) => {
        const grade = params.value;
        if (!isToolEnabled("updownio", params.row.url)) return <IconUnknown />;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir les détails updown.io pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={params.row.summary.uptimeGrade}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/disponibilite/#updownio`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });

    columns.push({
      ...defaultColumnsProps,
      field: "apdex",
      headerName: `ApDex`,
      width: 80,
      description:
        "Apdex: Application Performance Index : indice de satisfaction des attentes de performance (updown.io)",
      type: "number",
      valueGetter: (params) => {
        return params.row.summary.apdex || 0;
      },
      renderCell: (params) => {
        if (!isToolEnabled("updownio", params.row.url)) return <IconUnknown />;
        return (
          <GradeBadge
            title={`Voir les détails upwdown.io pour l'url ${slugifyUrl(
              params.row.url
            )}`}
            showCheckOnSuccess
            label={params.row.summary.apdexGrade}
            linkProps={{
              href: `/url/${slugifyUrl(
                params.row.url
              )}/disponibilite/#updownio`,
            }}
          />
        );
      },
    });
  }

  if (isColumnEnabled("nuclei")) {
    columns.push({
      ...defaultColumnsProps,
      field: "nuclei",
      headerName: `Nuclei`,
      description: "Vulnérabilités applicatives detectées avec Nucléi",
      type: "number",
      valueGetter: (params) => {
        return (params.row.nuclei && params.row.nuclei.length) || 0;
      },
      renderCell: (params) => {
        if (!isToolEnabled("nuclei", params.row.url)) return <IconUnknown />;
        return (
          <GradeBadge
            showCheckOnSuccess
            title={`Voir les détails nuclei pour l'url ${slugifyUrl(
              params.row.url
            )}`}
            label={(params.row.nuclei && params.row.nuclei.length) || 0}
            linkProps={{
              href: `/url/${slugifyUrl(params.row.url)}/securite/#nuclei`,
            }}
          />
        );
      },
    });
  }

  if (isColumnEnabled("dependabot")) {
    columns.push({
      ...defaultColumnsProps,
      field: "dependabot",
      headerName: `Vulnérabilités`,
      description:
        "Vulnérabilités applicatives detectées dans les dépendances du code (dependabot)",
      type: "number",
      valueGetter: (params) => {
        return params.row.summary.dependabotCount || 0;
      },
      renderCell: (params) => {
        if (!isToolEnabled("dependabot", params.row.url))
          return <IconUnknown />;
        return (
          <GradeBadge
            showCheckOnSuccess
            title={`Voir les détails dependabot pour l'url ${slugifyUrl(
              params.row.url
            )}`}
            label={params.row.summary.dependabotGrade}
            linkProps={{
              href: `/url/${slugifyUrl(params.row.url)}/securite/#dependabot`,
            }}
          />
        );
      },
    });
  }

  if (isColumnEnabled("codescan")) {
    columns.push({
      ...defaultColumnsProps,
      field: "codescan",
      headerName: `CodeQL`,
      description:
        "Potentielles vulnérabilités ou erreurs detectées dans les codes sources (CodeQL)",
      type: "number",
      valueGetter: (params) => {
        return params.row.summary.codescanCount || 0;
      },
      renderCell: (params) => {
        if (!isToolEnabled("codescan", params.row.url)) return <IconUnknown />;
        return (
          <GradeBadge
            title={`Voir les détails CodeQL pour l'url ${slugifyUrl(
              params.row.url
            )}`}
            showCheckOnSuccess
            label={params.row.summary.codescanGrade}
            linkProps={{
              href: `/url/${slugifyUrl(params.row.url)}/securite/#codescan`,
            }}
          />
        );
      },
    });
  }

  if (isColumnEnabled("nmap")) {
    columns.push({
      ...defaultColumnsProps,
      field: "nmap",
      headerName: `nmap`,
      description: "Vulnérabilités réseau detectées par Nmap",
      type: "string",
      valueGetter: (params) => {
        return params.row.summary.nmapGrade;
      },
      renderCell: (params) => {
        if (!isToolEnabled("nmap", params.row.url)) return <IconUnknown />;
        const grade = params.value;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir les détails nmap pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={grade}
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/securite/#nmap`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
    columns.push({
      ...defaultColumnsProps,
      field: "nmap2",
      headerName: `ports`,
      description: "Ports TCP ouverts détectés par nmap",
      type: "number",
      valueGetter: (params) => {
        return params.row.summary.nmapOpenPortsCount || 0;
      },
      renderCell: (params) => {
        if (!isToolEnabled("nmap", params.row.url)) return <IconUnknown />;
        const grade = params.row.summary.nmapOpenPortsGrade;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir les détails nmap pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={grade}
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/securite/#nmap`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("thirdparties")) {
    columns.push({
      ...defaultColumnsProps,
      field: "thirdparties",
      headerName: `Trackers`,
      description:
        "Nombre de scripts externes détectés. Certains scripts externes légitimes peuvent être considérés comme trackers.",
      type: "number",
      valueGetter: (params) => {
        return params.row.summary.trackersCount || 0;
      },
      renderCell: (params) => {
        if (!isToolEnabled("thirdparties", params.row.url))
          return <IconUnknown />;
        const grade = params.value;
        if (typeof grade !== "undefined") {
          if (params.row.summary.trackersCount === 0) {
            return (
              <GradeBadge
                title={`Voir les détails des trackers pour l'url ${slugifyUrl(
                  params.row.url
                )}`}
                showCheckOnSuccess
                label="A"
                linkProps={{
                  href: `/url/${slugifyUrl(
                    params.row.url
                  )}/best-practices/#thirdparties`,
                }}
              />
            );
          }
          return (
            <GradeBadge
              title={`Voir les détails des trackers pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={params.row.summary.trackersCount}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#thirdparties`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
    columns.push({
      ...defaultColumnsProps,
      field: "cookies",
      headerName: `Cookies`,
      description: "Nombre de cookies présents",
      type: "number",
      valueGetter: (params) => {
        return params.row.summary.cookiesCount || 0;
      },
      renderCell: (params) => {
        if (!isToolEnabled("thirdparties", params.row.url))
          return <IconUnknown />;
        const grade = params.value;
        if (typeof grade !== "undefined") {
          if (params.row.summary.cookiesCount === 0) {
            return (
              <GradeBadge
                title={`Voir les détails des cookies pour l'url ${slugifyUrl(
                  params.row.url
                )}`}
                showCheckOnSuccess
                label="A"
                linkProps={{
                  href: `/url/${slugifyUrl(
                    params.row.url
                  )}/best-practices/#cookies`,
                }}
              />
            );
          }

          return (
            <GradeBadge
              title={`Voir les détails des cookies pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={params.row.summary.cookiesCount}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#cookies`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("stats")) {
    columns.push({
      ...defaultColumnsProps,
      field: "stats",
      headerName: `Stats`,
      description: "Présence de la page des statistiques",
      type: "string",
      valueGetter: (params) => {
        return params.row.summary.statsGrade || "";
      },
      renderCell: (params) => {
        if (!isToolEnabled("stats", params.row.url)) return <IconUnknown />;
        const grade = params.value;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir la détection des stats pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={params.value}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#stats`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("budget_page")) {
    columns.push({
      ...defaultColumnsProps,
      field: "budget",
      headerName: `Budget`,
      description: "Présence de la page du budget",
      type: "string",
      valueGetter: (params) => {
        return params.row.summary.budgetPageGrade || "";
      },
      renderCell: (params) => {
        if (!isToolEnabled("budget_page", params.row.url))
          return <IconUnknown />;
        const grade = params.value;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir la détection du budget pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={params.value}
              linkProps={{
                href: `/url/${slugifyUrl(
                  params.row.url
                )}/best-practices/#budget_page`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("404")) {
    columns.push({
      ...defaultColumnsProps,
      field: "404",
      headerName: `404`,
      description: "Détection de liens brisés",
      type: "number",
      valueGetter: (params) => {
        const count = params.row.summary["404"] || null;
        return count === "A+" ? 0 : count;
      },
      renderCell: (params) => {
        if (!isToolEnabled("404", params.row.url)) return <IconUnknown />;
        const grade =
          params.value === "A+" || params.value === 0 ? "A" : params.value;
        return (
          (grade && (
            <GradeBadge
              title={`Voir les détails des pages en 404 pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={grade}
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/best-practices/#404`,
              }}
            />
          )) || <IconUnknown />
        );
      },
    });
  }

  if (isColumnEnabled("trivy")) {
    columns.push({
      ...defaultColumnsProps,
      field: "trivy",
      headerName: `Trivy`,
      description: "Vulnérabilités Trivy",
      type: "number",
      valueGetter: (params) => {
        return params.row.summary.trivyGrade;
      },
      renderCell: (params) => {
        if (!isToolEnabled("trivy", params.row.url)) return <IconUnknown />;
        const grade = params.value;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir les détails trivy pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={grade}
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/securite/#trivy`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("sonarcloud")) {
    columns.push({
      ...defaultColumnsProps,
      field: "sonarcloud",
      headerName: `Sonarcloud`,
      description: "Scan de code SonarCloud.io",
      type: "number",
      valueGetter: (params) => {
        return params.row.summary.sonarcloudGrade;
      },
      renderCell: (params) => {
        if (!isToolEnabled("sonarcloud", params.row.url))
          return <IconUnknown />;
        const grade = params.value;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir les détails sonarcloud pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={grade}
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/securite/#sonarcloud`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  if (isColumnEnabled("zap")) {
    columns.push({
      ...defaultColumnsProps,
      field: "zap",
      headerName: `Owasp`,
      description: "Scan de code ZaProxy baseline",
      valueGetter: (params) => {
        return params.row.summary.zapGrade;
      },
      renderCell: (params) => {
        if (!isToolEnabled("zap", params.row.url)) return <IconUnknown />;
        const grade = params.value;
        if (grade) {
          return (
            <GradeBadge
              title={`Voir les détails owaps pour l'url ${slugifyUrl(
                params.row.url
              )}`}
              showCheckOnSuccess
              label={
                params.row.summary.zapGrade === "A"
                  ? "A"
                  : params.row.summary.zapCount
              }
              severity={
                params.row.summary.zapGrade === "B"
                  ? "info"
                  : params.row.summary.zapGrade === "D"
                  ? "warning"
                  : params.row.summary.zapGrade === "F"
                  ? "error"
                  : "success"
              }
              linkProps={{
                href: `/url/${slugifyUrl(params.row.url)}/securite/#zap`,
              }}
            />
          );
        }
        return <IconUnknown />;
      },
    });
  }

  const filterBy = (key) => (item, idx, arr) =>
    !arr.slice(idx + 1).find((r) => item[key] === r[key]);

  const tableData =
    ((report &&
      report.filter(filterBy("url")).map((report) => {
        return {
          id: report.url,
          ...report,
        };
      })) ||
      []
    ).sort(sortByKey("url"));

  const ROWS_COUNT = 100;

  const SectionGrid = ({ rows }) => (
    <DataGrid
      rows={rows}
      columns={columns.map((c) =>
        c.field === "url"
          ? { ...c, headerName: `Repository (${rows.length})` }
          : c
      )}
      autoHeight={true}
      disableVirtualization
      disableColumnMenu={true}
      disableDensitySelector={true}
      rowSelection={false}
      hideFooterPagination={false}
      hideFooter={rows.length < ROWS_COUNT}
      localeText={{
        MuiTablePagination: { labelRowsPerPage: "Rows per page" },
      }}
      pagination={true}
    />
  );

  const grid = (rows) => <SectionGrid rows={rows} />;

  // group rows by category on a single page, when categories are set
  const categories = uniq(tableData.map((r) => r.category).filter(Boolean));
  if (categories.length > 1) {
    return (
      <>
        {categories.map((category) => (
          <section key={category} className={fr.cx("fr-mb-6w")}>
            <h2 className={fr.cx("fr-h3", "fr-mb-2w")}>{category}</h2>
            {grid(tableData.filter((r) => r.category === category))}
          </section>
        ))}
        {tableData.some((r) => !r.category) && (
          <section className={fr.cx("fr-mb-6w")}>
            <h2 className={fr.cx("fr-h3", "fr-mb-2w")}>Other</h2>
            {grid(tableData.filter((r) => !r.category))}
          </section>
        )}
      </>
    );
  }

  return (report && grid(tableData)) || null;
};
