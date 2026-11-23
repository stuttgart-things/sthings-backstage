import { Grid, makeStyles } from '@material-ui/core';
import { Content, Header, Page } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import {
  HomePageRecentlyVisited,
  HomePageStarredEntities,
  HomePageToolkit,
  HomePageTopVisited,
} from '@backstage/plugin-home';
import { HomePageSearchBar } from '@backstage/plugin-search';
import { SearchContextProvider } from '@backstage/plugin-search-react';
import {
  AnnouncementsCard,
  NewAnnouncementBanner,
} from '@backstage-community/plugin-announcements';
import CreateIcon from '@material-ui/icons/AddCircleOutline';
import CloudIcon from '@material-ui/icons/Cloud';
import ComputerIcon from '@material-ui/icons/Computer';
import CategoryIcon from '@material-ui/icons/Category';
import LibraryBooks from '@material-ui/icons/LibraryBooks';
import AnnouncementIcon from '@material-ui/icons/Announcement';
import { Greeting } from './Greeting';

const useStyles = makeStyles(theme => ({
  searchBar: {
    display: 'flex',
    maxWidth: '60vw',
    margin: theme.spacing(1, 'auto', 3),
    borderRadius: '50px',
    [theme.breakpoints.down('sm')]: { maxWidth: '100%' },
  },
}));

/**
 * Curated entry points ("trusted path light", #242/#243). Internal routes
 * only, so they work on every instance.
 */
export const TOOLS = [
  { label: 'Order', url: '/create', icon: <CreateIcon /> },
  {
    label: 'Clusters',
    url: '/catalog?filters[kind]=resource&filters[type]=kubernetes-cluster',
    icon: <CloudIcon />,
  },
  {
    label: 'VMs',
    url: '/catalog?filters[kind]=resource&filters[type]=vm',
    icon: <ComputerIcon />,
  },
  { label: 'Catalog', url: '/catalog', icon: <CategoryIcon /> },
  { label: 'Docs', url: '/docs', icon: <LibraryBooks /> },
  { label: 'News', url: '/announcements', icon: <AnnouncementIcon /> },
];

export function HomePage() {
  const classes = useStyles();
  const orgName =
    useApi(configApiRef).getOptionalString('organization.name') ?? 'Backstage';

  return (
    <SearchContextProvider>
      <Page themeId="home">
        {/* pageTitleOverride: the title is an element, which made the
            browser tab (and Top Visited) read "[object Object]". */}
        <Header
          title={<Greeting />}
          pageTitleOverride="Home"
          subtitle={orgName}
        />
        <Content>
          {/* Unseen announcements; the catalog no longer shows them (#242). */}
          <NewAnnouncementBanner max={3} />
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <HomePageSearchBar
                classes={{ root: classes.searchBar }}
                placeholder="Search"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <HomePageToolkit title="Platform" tools={TOOLS} />
            </Grid>
            <Grid item xs={12} md={6}>
              <AnnouncementsCard title="Platform news" max={3} />
            </Grid>
            <Grid item xs={12} md={4}>
              <HomePageStarredEntities />
            </Grid>
            <Grid item xs={12} md={4}>
              <HomePageRecentlyVisited />
            </Grid>
            <Grid item xs={12} md={4}>
              <HomePageTopVisited />
            </Grid>
          </Grid>
        </Content>
      </Page>
    </SearchContextProvider>
  );
}
