import * as React from "react";
import Badge from "@codegouvfr/react-dsfr/Badge";
import Alert from "@codegouvfr/react-dsfr/Alert";

import { Panel } from "./Panel";
import { GradeBadge } from "./GradeBadge";

type RepoChecksProps = { data: RepoChecksReport };

export const GitHubFileLink = ({
  repository,
  branch,
  file,
}: {
  repository: string;
  branch: string | null;
  file: string | null;
}) =>
  file ? (
    <a
      href={`https://github.com/${repository}/blob/${branch || "main"}/${file}`}
      target="_blank"
      rel="noopener"
    >
      <code>{file}</code>
    </a>
  ) : (
    <>unknown</>
  );

export const RepoChecks: React.FC<RepoChecksProps> = ({ data }) => {
  if (!data) return null;

  const linkProps = {
    href: `https://github.com/${data.repository}`,
    target: "_blank",
  };

  if (data.error) {
    return (
      <Panel title="GitHub repository analysis" titleAs="h2">
        <Alert
          severity="error"
          title="Analysis failed"
          description={
            <>
              The repository {data.repository} could not be analyzed (missing,
              private or renamed?).
              <br />
              <small>{data.error}</small>
            </>
          }
        />
      </Panel>
    );
  }

  const { backend, frontend } = data;

  return (
    <Panel
      title="GitHub repository analysis"
      titleAs="h2"
      url={`https://github.com/${data.repository}`}
      urlText="View repository"
    >
      <h3>SECURITY.md</h3>
      <ul>
        <li>
          {data.security_md && data.security_md.present ? (
            <>
              <Badge noIcon severity="success">
                present
              </Badge>
              &nbsp;(
              <a
                href={`https://github.com/${data.repository}/blob/${data.branch || "main"}/${data.security_md.path}`}
                target="_blank"
                rel="noopener"
              >
                <code>{data.security_md.path}</code>
              </a>
              )
            </>
          ) : (
            <>
              <Badge noIcon severity="error">
                missing
              </Badge>
              &nbsp;— no SECURITY.md at the root, in .github/ or docs/
            </>
          )}
        </li>
      </ul>
      <h3>Backend Docker image</h3>
      <ul>
        <li>
          Dockerfile&nbsp;:{" "}
          <GitHubFileLink
            repository={data.repository}
            branch={data.branch}
            file={backend && backend.dockerfile}
          />
        </li>
        <li>
          Runtime&nbsp;:{" "}
          {backend && backend.runtime ? (
            <>
              <Badge noIcon severity="info">
                {backend.runtime.language} {backend.runtime.version}
              </Badge>
              &nbsp;({backend.runtime.strategy},{" "}
              <GitHubFileLink
                repository={data.repository}
                branch={data.branch}
                file={backend.runtime.source}
              />
              )
            </>
          ) : (
            <>not detected</>
          )}
        </li>
        <li>
          Runs as non-root&nbsp;:{" "}
          {backend && backend.runs_as_non_root && backend.runs_as_non_root.supported ? (
            <GradeBadge label="A" severity="success" showCheckOnSuccess linkProps={linkProps} />
          ) : (
            <GradeBadge
              label="F"
              severity="error"
              linkProps={linkProps}
            />
          )}
          {backend && backend.runs_as_non_root && backend.runs_as_non_root.evidence && (
            <>
              &nbsp;({backend.runs_as_non_root.evidence})
            </>
          )}
        </li>
        <li>
          HEALTHCHECK&nbsp;:{" "}
          {backend && backend.healthcheck && backend.healthcheck.present ? (
            <>
              <GradeBadge label="A" severity="success" showCheckOnSuccess linkProps={linkProps} />
              &nbsp;({backend.healthcheck.count} instruction(s))
            </>
          ) : (
            <GradeBadge
              label="F"
              severity="error"
              linkProps={linkProps}
            />
          )}
        </li>
        <li>
          Distroless support&nbsp;:{" "}
          {backend && backend.distroless && backend.distroless.supported ? (
            <>
              <GradeBadge label="A" severity="success" showCheckOnSuccess linkProps={linkProps} />
              <ul>
                {backend.distroless.images.map((image, i) => (
                  <li key={i}>
                    stage <code>{image.stage || "?"}</code>&nbsp;on{" "}
                    <code>{image.image}</code>
                    <ul>
                      <li>
                        digest pinning&nbsp;:{" "}
                        {image.digest_pinned ? (
                          <Badge noIcon severity="success">
                            yes
                          </Badge>
                        ) : (
                          <Badge noIcon severity="error">
                            no
                          </Badge>
                        )}
                      </li>
                      <li>
                        non-root execution&nbsp;:{" "}
                        {/nonroot/i.test(image.image) ? (
                          <Badge noIcon severity="success">
                            yes
                          </Badge>
                        ) : (
                          <Badge noIcon severity="error">
                            no
                          </Badge>
                        )}
                      </li>
                      <li>
                        variant&nbsp;:{" "}
                        <code>
                          {(image.image.match(/distroless\/([^-]+)/) || [])[1] ||
                            image.image}
                          {/-debian\d+/.test(image.image) ? " (glibc)" : ""}
                        </code>
                      </li>
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <GradeBadge
              label="F"
              severity="error"
              linkProps={linkProps}
            />
          )}
        </li>
      </ul>
      <h3>Frontend Docker image</h3>
      {frontend && frontend.monolith ? (
        <>
          <p>
            Monolithic app: the Node backend serves the frontend directly,
            there is no separate frontend server (neither Caddy nor nginx).
          </p>
          <ul>
            <li>
              Dockerfile&nbsp;:{" "}
              <GitHubFileLink
                repository={data.repository}
                branch={data.branch}
                file={frontend.dockerfile}
              />
            </li>
          </ul>
        </>
      ) : (
        <ul>
          <li>
            Dockerfile&nbsp;:{" "}
            <GitHubFileLink
              repository={data.repository}
              branch={data.branch}
              file={frontend && frontend.dockerfile}
            />
          </li>
          <li>
            Served by Caddy&nbsp;:{" "}
            {frontend && frontend.caddy ? (
              <GradeBadge label="A" severity="success" showCheckOnSuccess linkProps={linkProps} />
            ) : (
              <GradeBadge label="F" severity="error" linkProps={linkProps} />
            )}
          </li>
          {frontend && frontend.distroless && frontend.distroless.supported && (
            <li>
              The frontend runtime is also distroless&nbsp;:{" "}
              {frontend.distroless.images.map((i) => i.image).join(", ")}
            </li>
          )}
        </ul>
      )}
      <h3>External base images</h3>
      {data.base_images && data.base_images.images.length ? (
        <>
          <p>
            {data.base_images.pinned
              ? "All base images are pinned by digest (@sha256)."
              : `${data.base_images.images.filter((i) => !i.digest_pinned).length} of ${data.base_images.images.length} base images are not pinned by digest.`}
          </p>
          <ul>
            {data.base_images.images.map((image, i) => (
              <li key={i}>
                <code>{image.image}</code>
                {image.stage && image.stage !== "?" && (
                  <>
                    &nbsp;(stage <code>{image.stage}</code>)
                  </>
                )}
                &nbsp;in{" "}
                <GitHubFileLink
                  repository={data.repository}
                  branch={data.branch}
                  file={image.dockerfile}
                />
                &nbsp;:{" "}
                {image.digest_pinned ? (
                  <Badge noIcon severity="success">
                    pinned
                  </Badge>
                ) : (
                  <Badge noIcon severity="error">
                    unpinned
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>No external base images detected.</p>
      )}
    </Panel>
  );
};
