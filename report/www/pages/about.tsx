import type { NextPage } from "next";
import Head from "next/head";

import { About } from "../src/components/About";
import dashlordConfig from "@/config.json";

const PageIntro: NextPage = () => {
  return (
    <>
      <Head>
        <title>About - {dashlordConfig.title}</title>
      </Head>
      <h1>About</h1>
      <About />
    </>
  );
};

export default PageIntro;
