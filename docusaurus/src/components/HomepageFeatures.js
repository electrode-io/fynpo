import React from "react";
import clsx from "clsx";
import styles from "./HomepageFeatures.module.css";

const FeatureList = [
  {
    title: "Easier Development",
    description: (
      <>
        Code, publish, and test all your packages using local sources without
        skipping a beat
      </>
    )
  },
  {
    title: "A Different Approach",
    description: (
      <>
        Offers all the benefits of a monorepo workspace, without any of the
        usual downsides.
      </>
    )
  },
  {
    title: "Flexible",
    description: (
      <>
        Develop and test with local packages outside of your monorepo directly
      </>
    )
  },
  {
    title: "npm Workflow",
    description: (
      <>
        Designed from the ground up to enable a monorepo that integrates with
        the standard npm workflow
      </>
    )
  },

  {
    title: "Hybrid Publish Mode",
    description: (
      <>Allows selected packages to lock versions or be independent</>
    )
  },
  {
    title: "Local Package Resolution",
    description: (
      <>
        Local package resolution logic fully integrated with the normal npm
        package.json install process
      </>
    )
  }
];

function Feature({ title, description }) {
  return (
    <div className={clsx("col col--4 padding-vert--md")}>
      <div className="text--center padding-horiz--md">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
