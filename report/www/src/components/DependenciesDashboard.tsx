import * as React from "react";
import Link from "next/link";
import Badge from "@codegouvfr/react-dsfr/Badge";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { fr } from "@codegouvfr/react-dsfr";
import uniq from "lodash.uniq";

import {
  smallUrl,
  slugifyUrl,
  getLastUrlSegment,
  sortByKey,
  pythonVersionTooOld,
} from "../utils";

type DependenciesDashboardProps = { report: DashLordReport };

const uiShortName = (name: string) =>
  name
    .split("/")
    .pop()
    .replace(/^react-/, "")
    .replace(/-components$/, "");

const VersionCell = ({ value }: { value?: string | null }) =>
  value ? (
    <Badge noIcon severity="info">
      {value}
    </Badge>
  ) : (
    <span style={{ color: "var(--text-mention-grey)" }}>–</span>
  );

export const DependenciesDashboard: React.FC<DependenciesDashboardProps> = ({
  report,
}) => {
  const defaultColumnsProps = {
    sortable: true,
    width: 140,
    type: "string",
    headerAlign: "center" as const,
    align: "center" as const,
  };

  const getRepocheks = (row: UrlReport) => row.repocheks || null;
  const dep = (row: UrlReport) => getRepocheks(row)?.dependencies || null;

  const columns: GridColDef[] = [
    {
      ...defaultColumnsProps,
      field: "url",
      headerAlign: "left",
      align: "left",
      headerName: `Repository (${report.length})`,
      width: 220,
      renderCell: (params) => (
        <Link
          prefetch={false}
          title={`View details for ${getLastUrlSegment(params.value) || smallUrl(params.value)}`}
          href={`/url/${encodeURIComponent(slugifyUrl(params.value))}/dependencies/`}
        >
          {getLastUrlSegment(params.value) || smallUrl(params.value)}
        </Link>
      ),
    },
    {
      ...defaultColumnsProps,
      field: "runtime",
      headerName: "Runtime",
      description:
        "Language and version of the backend image runtime (python below 3.14.10 / 3.13.18 is a warning)",
      renderCell: (params) => {
        const rt = getRepocheks(params.row as UrlReport)?.backend?.runtime;
        if (!rt) return <VersionCell value={null} />;
        const value = `${rt.language} ${rt.version}`;
        if (rt.language === "python" && pythonVersionTooOld(rt.version))
          return (
            <span title="below 3.14.10 / 3.13.18">
              <Badge noIcon severity="warning">
                {value}
              </Badge>
            </span>
          );
        return <Badge noIcon severity="info">{value}</Badge>;
      },
    },
    {
      ...defaultColumnsProps,
      field: "uikit",
      headerName: "UI-Kit",
      description: "DSFR / UI packages used by the frontend",
      width: 160,
      valueGetter: (params) => {
        const d = getRepocheks(params.row as UrlReport);
        const components = (d?.ui_components || []).filter(
          (c) => !/-tokens$/.test(c.name) && !/cunningham/.test(c.name)
        );
        const uiKit = (d?.ui_components || []).find((c) => /\/ui-kit$/.test(c.name));
        if (uiKit) return `ui-kit ${uiKit.spec} (deprecated)`;
        return components
          .map((c) => `${uiShortName(c.name)} ${c.spec}`)
          .join(" · ");
      },
      renderCell: (params) => {
        const d = getRepocheks(params.row as UrlReport);
        const components = (d?.ui_components || []).filter(
          (c) => !/-tokens$/.test(c.name) && !/cunningham/.test(c.name)
        );
        const uiKit = (d?.ui_components || []).find((c) => /\/ui-kit$/.test(c.name));
        if (uiKit)
          return (
            <Badge noIcon severity="warning">
              ui-kit {uiKit.spec}
            </Badge>
          );
        if (components.length)
          return (
            <Badge noIcon severity="info">
              {components.map((c) => `${uiShortName(c.name)} ${c.spec}`).join(" · ")}
            </Badge>
          );
        // a frontend without any DSFR / UI package is an error; no frontend
        // at all is not applicable
        if (d?.frontend)
          return (
            <span title="No DSFR / UI package detected in the frontend">
              <Badge noIcon severity="error">
                none
              </Badge>
            </span>
          );
        return <VersionCell value={null} />;
      },
    },
    {
      ...defaultColumnsProps,
      field: "py-pm",
      headerName: "uv / pip / poetry",
      width: 130,
      valueGetter: (params) => {
        const pm = dep(params.row as UrlReport)?.python?.package_manager;
        return pm ? `${pm.name}${pm.version ? " " + pm.version : ""}` : "";
      },
      renderCell: (params) => {
        const pm = dep(params.row as UrlReport)?.python?.package_manager;
        return (
          <VersionCell
            value={pm ? `${pm.name}${pm.version ? " " + pm.version : ""}` : null}
          />
        );
      },
    },
    {
      ...defaultColumnsProps,
      field: "django",
      headerName: "Django",
      valueGetter: (params) => dep(params.row as UrlReport)?.python?.django || "",
      renderCell: (params) => (
        <VersionCell value={dep(params.row as UrlReport)?.python?.django} />
      ),
    },
    {
      ...defaultColumnsProps,
      field: "django-lasuite",
      headerName: "django-lasuite",
      valueGetter: (params) =>
        dep(params.row as UrlReport)?.python?.["django-lasuite"] || "",
      renderCell: (params) => (
        <VersionCell value={dep(params.row as UrlReport)?.python?.["django-lasuite"]} />
      ),
    },
    {
      ...defaultColumnsProps,
      field: "router",
      headerName: "Router",
      width: 170,
      description:
        "Top-level router: Next.js for Next apps, or the SPA router library",
      valueGetter: (params) => {
        const router = dep(params.row as UrlReport)?.node?.router;
        return router ? `${router.name} ${router.version}` : "";
      },
      renderCell: (params) => {
        const router = dep(params.row as UrlReport)?.node?.router;
        return (
          <VersionCell
            value={router ? `${router.name} ${router.version}` : null}
          />
        );
      },
    },
    {
      ...defaultColumnsProps,
      field: "typescript",
      headerName: "TypeScript",
      valueGetter: (params) => dep(params.row as UrlReport)?.node?.typescript || "",
      renderCell: (params) => (
        <VersionCell value={dep(params.row as UrlReport)?.node?.typescript} />
      ),
    },
    {
      ...defaultColumnsProps,
      field: "bundler",
      headerName: "Bundler",
      description: "Bundler: Next.js embedded, or vite / webpack",
      valueGetter: (params) => {
        const b = dep(params.row as UrlReport)?.node?.bundler;
        return b ? `${b.name} ${b.version}` : "";
      },
      renderCell: (params) => {
        const b = dep(params.row as UrlReport)?.node?.bundler;
        return <VersionCell value={b ? `${b.name} ${b.version}` : null} />;
      },
    },
    {
      ...defaultColumnsProps,
      field: "package-manager",
      headerName: "npm / yarn / pnpm",
      width: 160,
      valueGetter: (params) => {
        const pm = dep(params.row as UrlReport)?.node?.package_manager;
        return pm ? `${pm.name}${pm.version ? "@" + pm.version : ""}` : "";
      },
      renderCell: (params) => {
        const pm = dep(params.row as UrlReport)?.node?.package_manager;
        return (
          <VersionCell
            value={pm ? `${pm.name}${pm.version ? "@" + pm.version : ""}` : null}
          />
        );
      },
    },
  ];

  const tableData = (report || [])
    .map((r) => ({ id: r.url, ...r }))
    .sort(sortByKey("url"));

  const grid = (rows) => (
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
      hideFooter={rows.length < 100}
      localeText={{
        MuiTablePagination: { labelRowsPerPage: "Rows per page" },
      }}
      pagination={true}
    />
  );

  // group rows by category, same as the main dashboard
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
      </>
    );
  }

  return grid(tableData);
};
