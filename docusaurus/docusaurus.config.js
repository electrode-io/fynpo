/** @type {import('@docusaurus/types').DocusaurusConfig} */
module.exports = {
  title: "fynpo",
  tagline: "A zero setup JavaScript monorepo manager",
  url: "https://jchip.github.io/fynpo/",
  baseUrl: "/fynpo/",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  favicon: "img/favicon.png",
  organizationName: "electrode-io",
  projectName: "fynpo",
  themeConfig: {
    navbar: {
      title: "fynpo",
      logo: {
        alt: "fynpo logo",
        src: "img/electrode.png",
      },
      items: [
        {
          type: "doc",
          docId: "intro",
          position: "left",
          label: "Docs",
        },
        //{to: '/tutorial-basics', label: 'Tutorial', position: 'left'},
        {
          href: "https://github.com/jchip/fynpo/",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      copyright: `Copyright © 2017-2021 Walmart`,
    },
  },
  presets: [
    [
      "@docusaurus/preset-classic",
      {
        docs: {
          sidebarPath: require.resolve("./sidebars.js"),
          // Please change this to your repo.
          editUrl: "https://github.com/jchip/fynpo/tree/main/docusaurus/docs",
        },
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      },
    ],
  ],
};
