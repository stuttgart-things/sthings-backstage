import { Grid, Typography, Box } from '@material-ui/core';
import { makeStyles, Theme } from '@material-ui/core/styles';
import {
  Content,
  ContentHeader,
  CreateButton,
  PageWithHeader,
  Progress,
  SupportButton,
} from '@backstage/core-components';
import {
  CatalogFilterLayout,
  EntityKindPicker,
  EntityLifecyclePicker,
  EntityListProvider,
  EntityOwnerPicker,
  EntityTagPicker,
  EntityTypePicker,
  UserListPicker,
  useEntityList,
} from '@backstage/plugin-catalog-react';
import { configApiRef, createRoutableExtension, useApi } from '@backstage/core-plugin-api';
import { catalogPlugin } from '@backstage/plugin-catalog';
import { EntityCard } from './EntityCard';

const useStyles = makeStyles((theme: Theme) => ({
  gridContainer: {
    marginTop: theme.spacing(1),
  },
  empty: {
    textAlign: 'center' as const,
    padding: theme.spacing(8, 2),
    color: theme.palette.text.secondary,
  },
  resultCount: {
    color: theme.palette.text.secondary,
    fontSize: '0.85rem',
    fontWeight: 500,
    marginBottom: theme.spacing(2),
  },
}));

function CatalogCardGrid() {
  const classes = useStyles();
  const { entities, loading, error } = useEntityList();

  if (loading) {
    return <Progress />;
  }

  if (error) {
    return (
      <Box className={classes.empty}>
        <Typography variant="h6">Failed to load entities</Typography>
        <Typography variant="body2">{error.message}</Typography>
      </Box>
    );
  }

  if (!entities.length) {
    return (
      <Box className={classes.empty}>
        <Typography variant="h6">No entities found</Typography>
        <Typography variant="body2">
          Try adjusting your filters or register a new component.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Typography className={classes.resultCount}>
        {entities.length} {entities.length === 1 ? 'result' : 'results'}
      </Typography>
      <Grid container spacing={2} className={classes.gridContainer}>
        {entities.map(entity => {
          const key = `${entity.kind}:${entity.metadata.namespace || 'default'}/${entity.metadata.name}`;
          return (
            <Grid item xs={12} sm={6} md={4} lg={4} key={key}>
              <EntityCard entity={entity} />
            </Grid>
          );
        })}
      </Grid>
    </>
  );
}

function CustomCatalogPageContent() {
  const orgName =
    useApi(configApiRef).getOptionalString('organization.name') ?? 'Backstage';

  return (
    <PageWithHeader title={orgName} themeId="home">
      <Content>
        <ContentHeader title="">
          <CreateButton
            title="Register Existing Component"
            to="/catalog-import"
          />
          <SupportButton>All your software catalog entities</SupportButton>
        </ContentHeader>
        <EntityListProvider>
          <CatalogFilterLayout>
            <CatalogFilterLayout.Filters>
              <EntityKindPicker />
              <EntityTypePicker />
              <UserListPicker />
              <EntityOwnerPicker />
              <EntityLifecyclePicker />
              <EntityTagPicker />
            </CatalogFilterLayout.Filters>
            <CatalogFilterLayout.Content>
              <CatalogCardGrid />
            </CatalogFilterLayout.Content>
          </CatalogFilterLayout>
        </EntityListProvider>
      </Content>
    </PageWithHeader>
  );
}

export const CustomCatalogPage = catalogPlugin.provide(
  createRoutableExtension({
    name: 'CustomCatalogPage',
    component: () => Promise.resolve(CustomCatalogPageContent),
    mountPoint: catalogPlugin.routes.catalogIndex,
  }),
);
