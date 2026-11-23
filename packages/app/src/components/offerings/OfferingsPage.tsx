import { Grid, Typography } from '@material-ui/core';
import {
  Content,
  ContentHeader,
  EmptyState,
  Header,
  Link,
  Page,
  Progress,
  ResponseErrorPanel,
  SupportButton,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { useEffect, useState } from 'react';
import { OfferingCard } from './OfferingCard';
import { groupOfferings, OFFERING_TYPE, OfferingGroup } from './offerings';

const OfferingsContent = () => {
  const catalogApi = useApi(catalogApiRef);
  const [value, setValue] = useState<OfferingGroup[]>();
  const [error, setError] = useState<Error>();
  useEffect(() => {
    let active = true;
    catalogApi
      .getEntities({ filter: { kind: 'Resource', 'spec.type': OFFERING_TYPE } })
      .then(({ items }) => active && setValue(groupOfferings(items)))
      .catch(e => active && setError(e));
    return () => {
      active = false;
    };
  }, [catalogApi]);
  const loading = !value && !error;

  if (loading) return <Progress />;
  if (error) return <ResponseErrorPanel error={error} />;
  if (!value?.length) {
    return (
      <EmptyState
        missing="data"
        title="No offerings yet"
        description={
          <>
            Offerings are catalog Resources with{' '}
            <code>spec.type: offering</code>. See the{' '}
            <Link to="/docs">docs</Link> chapter &quot;Offerings&quot;.
          </>
        }
      />
    );
  }

  return (
    <>
      {value.map(group => (
        <section key={group.name} aria-label={group.name}>
          <Typography variant="h5" component="h2" gutterBottom>
            {group.name}
          </Typography>
          <Grid container spacing={3} style={{ marginBottom: 24 }}>
            {group.offerings.map(entity => (
              <Grid
                item
                xs={12}
                sm={6}
                md={4}
                key={entity.metadata.uid ?? entity.metadata.name}
              >
                <OfferingCard entity={entity} />
              </Grid>
            ))}
          </Grid>
        </section>
      ))}
    </>
  );
};

/** Curated entry points, grouped by phase or topic (#243). */
export const OfferingsPage = () => (
  <Page themeId="home">
    <Header title="Offerings" subtitle="What the platform offers you" />
    <Content>
      <ContentHeader title="">
        <SupportButton>
          Curated entry points: order a VM, request a cluster, file a claim,
          read the docs. Each offering is a catalog entity.
        </SupportButton>
      </ContentHeader>
      <OfferingsContent />
    </Content>
  </Page>
);
