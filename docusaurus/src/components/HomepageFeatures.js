import React from 'react';
import clsx from 'clsx';
import styles from './HomepageFeatures.module.css';

const FeatureList = [
  {
    title: 'Easy to Use',
    description: (
      <>
        Code, publish, and test all in your packages using local sources without skipping a beat.
      </>
    ),
  },
  {
    title: 'Npm Compatible workflow',
    description: (
      <>
        Designed from the ground up to enable a mono-repo that 100% retains the standard npm workflow.
      </>
    ),
  },
  {
    title: 'Efficient Storage',
    description: (
      <>
        Uses a central storage for all of a mono-repo's dependencies.
      </>
    ),
  },
  {
    title: 'Hybrid Publish Mode',
    description: (
      <>
        Allows selected packages to lock versions or be independent.
      </>
    ),
  },
  {
    title: 'Local Package Resolution',
    description: (
      <>
        Local package resolution logic fully integrated with the normal NPM package.json install process.
      </>
    ),
  },
  {
    title: 'Smaller node_modules',
    description: (
      <>
        Guarantees install of single copy of packages
      </>
    ),
  },
];

function Feature({title, description}) {
  return (
    <div className={clsx('col col--4 padding-vert--md')}>
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
