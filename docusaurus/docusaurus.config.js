/** @type {import('@docusaurus/types').DocusaurusConfig} */
module.exports = {
  title: 'Fynpo',
  tagline: 'All the benefits of a mono-repo workspace, without any of the downsides',
  url: 'https://www.electrode.io',
  baseUrl: '/fynpo/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.png',
  organizationName: 'electrode-io',
  projectName: 'fynpo',
  themeConfig: {
    navbar: {
      title: 'Fynpo',
      logo: {
        alt: 'Fynpo Logo',
        src: 'img/electrode.png',
      },
      items: [
        {
          type: 'doc',
          docId: 'intro',
          position: 'left',
          label: 'Docs',
        },
        //{to: '/tutorial-basics', label: 'Tutorial', position: 'left'},
        {
          href: 'https://github.com/electrode-io/fynpo/',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} Walmart`,
    },
  },
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          // Please change this to your repo.
          editUrl:
            'https://github.com/electrode-io/fynpo/tree/master/docusaurus/docs',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
};
