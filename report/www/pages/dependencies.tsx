import type { NextPage } from "next";
import Head from "next/head";

import { DependenciesDashboard } from "../src/components/DependenciesDashboard";
import report from "@/report.json";
import dashlordConfig from "@/config.json";

const Dependencies: NextPage = () => {
  return (
    <>
      <Head>
        <title>Dependencies - {dashlordConfig.title}</title>
      </Head>
      <DependenciesDashboard report={report} />
    </>
  );
};

export default Dependencies;
