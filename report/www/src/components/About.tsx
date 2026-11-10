import * as React from "react";
import Link from "next/link";

import CallOut from "@codegouvfr/react-dsfr/CallOut";

export const About: React.FC = () => (
  <CallOut className="fr-mb-3w">
    DashLord is <strong>100% open source</strong>, you can contribute by
    writing documentation, proposing code, or sharing your questions{" "}
    <a
      href="https://github.com/socialgouv/dashlord"
      target="_blank"
      rel="noopener noreferrer"
    >
      on the GitHub repository
    </a>
    .
    <br /> <br />
    DashLord&apos;s goal is to identify points of attention and propose
    actionable fixes.
    <br /> <br />
    You can easily create your own DashLord for your repositories by following{" "}
    <a
      href="https://github.com/SocialGouv/dashlord/blob/main/README.md"
      target="_blank"
      rel="noopener noreferrer"
    >
      the instructions on GitHub
    </a>
    .
  </CallOut>
);
