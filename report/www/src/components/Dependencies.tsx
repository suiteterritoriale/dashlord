import * as React from "react";
import Badge from "@codegouvfr/react-dsfr/Badge";

import { Panel } from "./Panel";
import { GitHubFileLink } from "./RepoChecks";
import { pythonVersionTooOld, dependencyStatus } from "../utils";

type DependenciesProps = { data: RepoChecksReport };

export const Dependencies: React.FC<DependenciesProps> = ({ data }) => {
  if (!data) return null;

  const { backend } = data;
  const status = dependencyStatus(data);

  return (
    <>
      {status && (
        <p>
          <Badge
            noIcon
            severity={
              status.status === "A"
                ? "success"
                : status.status === "W"
                  ? "warning"
                  : "error"
            }
          >
            {status.status === "A" ? "OK" : status.status}
          </Badge>
          &nbsp;{status.title}
        </p>
      )}
      <Panel
        title="Runtime"
        titleAs="h2"
        url={`https://github.com/${data.repository}`}
        urlText="View repository"
      >
        {backend && backend.runtime ? (
          <ul>
            <li>
              Language&nbsp;:{" "}
              {backend.runtime.language === "python" &&
              pythonVersionTooOld(backend.runtime.version) ? (
                <>
                  <Badge noIcon severity="warning">
                    {backend.runtime.language} {backend.runtime.version}
                  </Badge>
                  &nbsp;— below 3.14.10 / 3.13.18
                </>
              ) : (
                <Badge noIcon severity="info">
                  {backend.runtime.language} {backend.runtime.version}
                </Badge>
              )}
            </li>
            <li>
              Strategy&nbsp;: <code>{backend.runtime.strategy}</code>
            </li>
            <li>
              Pinned in&nbsp;:{" "}
              <GitHubFileLink
                repository={data.repository}
                branch={data.branch}
                file={backend.runtime.source}
              />
            </li>
            {data.dependencies?.python?.package_manager && (
              <li>
                Python package manager&nbsp;:{" "}
                <Badge noIcon severity="info">
                  {data.dependencies.python.package_manager.name}
                  {data.dependencies.python.package_manager.version
                    ? ` ${data.dependencies.python.package_manager.version}`
                    : ""}
                </Badge>
              </li>
            )}
          </ul>
        ) : (
          <p>No runtime detected.</p>
        )}
      </Panel>
      <Panel title="Frontend toolchain" titleAs="h2">
        {data.dependencies?.node ? (
          <ul>
            {data.dependencies.node.package_manager && (
              <li>
                Package manager&nbsp;:{" "}
                <Badge noIcon severity="info">
                  {data.dependencies.node.package_manager.name}
                  {data.dependencies.node.package_manager.version
                    ? `@${data.dependencies.node.package_manager.version}`
                    : ""}
                </Badge>
              </li>
            )}
            {data.dependencies.node.router && (
              <li>
                Router&nbsp;:{" "}
                <Badge noIcon severity="info">
                  {data.dependencies.node.router.name}{" "}
                  {data.dependencies.node.router.version}
                </Badge>
              </li>
            )}
            {data.dependencies.node.bundler && (
              <li>
                Bundler&nbsp;:{" "}
                <Badge noIcon severity="info">
                  {data.dependencies.node.bundler.name}{" "}
                  {data.dependencies.node.bundler.version}
                </Badge>
              </li>
            )}
            {data.dependencies.node.typescript && (
              <li>
                TypeScript&nbsp;:{" "}
                <Badge noIcon severity="info">
                  {data.dependencies.node.typescript}
                </Badge>
              </li>
            )}
            {data.dependencies.node.next && (
              <li>
                Next.js&nbsp;:{" "}
                <Badge noIcon severity="info">
                  {data.dependencies.node.next}
                </Badge>
              </li>
            )}
          </ul>
        ) : (
          <p>Not applicable.</p>
        )}
      </Panel>
      <Panel title="UI components" titleAs="h2">
        {(() => {
          const components = (data.ui_components || []).filter(
            (c) => !/cunningham/.test(c.name)
          );
          if (components.length)
            return (
              <ul>
                {components.map((component) => {
                  const deprecated = /\/ui-kit$/.test(component.name);
                  return (
                    <li key={component.name}>
                      <Badge noIcon severity={deprecated ? "warning" : "info"}>
                        {component.name.split("/").pop()} {component.spec}
                        {deprecated ? " (deprecated)" : ""}
                      </Badge>
                      &nbsp;— <code>{component.name}</code> (
                      <GitHubFileLink
                        repository={data.repository}
                        branch={data.branch}
                        file={component.source}
                      />
                      )
                    </li>
                  );
                })}
                {components.some((c) => /\/ui-kit$/.test(c.name)) && (
                  <li>
                    @gouvfr-lasuite/ui-kit is deprecated, migrate to
                    @gouvfr-lasuite/ui-components.
                  </li>
                )}
              </ul>
            );
          if (data.frontend)
            return (
              <p>
                <Badge noIcon severity="error">
                  none
                </Badge>
                &nbsp;No DSFR / UI package detected in the frontend.
              </p>
            );
          return <p>Not applicable: no frontend.</p>;
        })()}
      </Panel>
    </>
  );
};
