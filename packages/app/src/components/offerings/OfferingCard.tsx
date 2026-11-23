import type { ReactElement } from 'react';
import {
  Box,
  Card,
  CardActions,
  CardContent,
  Typography,
  makeStyles,
} from '@material-ui/core';
import { LinkButton } from '@backstage/core-components';
import { Entity, getCompoundEntityRef } from '@backstage/catalog-model';
import { entityRouteRef } from '@backstage/plugin-catalog-react';
import { useRouteRef } from '@backstage/core-plugin-api';
import ComputerIcon from '@material-ui/icons/Computer';
import CloudIcon from '@material-ui/icons/Cloud';
import LayersIcon from '@material-ui/icons/Layers';
import AddCircleIcon from '@material-ui/icons/AddCircleOutline';
import LibraryBooksIcon from '@material-ui/icons/LibraryBooks';
import StorageIcon from '@material-ui/icons/Storage';
import BuildIcon from '@material-ui/icons/Build';
import SchoolIcon from '@material-ui/icons/School';
import StarIcon from '@material-ui/icons/StarBorder';
import { ICON_ANNOTATION, offeringHref } from './offerings';

/** Icon keys for the offering-icon annotation. */
export const OFFERING_ICONS: Record<string, () => ReactElement> = {
  vm: () => <ComputerIcon />,
  cluster: () => <CloudIcon />,
  claim: () => <LayersIcon />,
  order: () => <AddCircleIcon />,
  docs: () => <LibraryBooksIcon />,
  storage: () => <StorageIcon />,
  tools: () => <BuildIcon />,
  learn: () => <SchoolIcon />,
};

const useStyles = makeStyles(theme => ({
  card: { height: '100%', display: 'flex', flexDirection: 'column' },
  content: { flexGrow: 1 },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(1),
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 10,
    color: theme.palette.primary.main,
    backgroundColor:
      theme.palette.type === 'dark'
        ? 'rgba(157,143,232,0.12)'
        : 'rgba(59,48,132,0.08)',
    flexShrink: 0,
  },
  actions: {
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    padding: theme.spacing(0, 2, 2),
  },
}));

export const OfferingCard = ({ entity }: { entity: Entity }) => {
  const classes = useStyles();
  const entityRoute = useRouteRef(entityRouteRef);
  const iconKey = entity.metadata.annotations?.[ICON_ANNOTATION] ?? '';
  const icon = (OFFERING_ICONS[iconKey] ?? (() => <StarIcon />))();
  const links = entity.metadata.links ?? [];
  const ref = getCompoundEntityRef(entity);
  const details = entityRoute({
    kind: ref.kind.toLocaleLowerCase('en-US'),
    namespace: ref.namespace,
    name: ref.name,
  });

  return (
    <Card variant="outlined" className={classes.card}>
      <CardContent className={classes.content}>
        <Box className={classes.header}>
          <Box className={classes.icon}>{icon}</Box>
          <Typography variant="h6" component="h3">
            {entity.metadata.title ?? entity.metadata.name}
          </Typography>
        </Box>
        <Typography variant="body2" color="textSecondary">
          {entity.metadata.description ?? ''}
        </Typography>
      </CardContent>
      <CardActions className={classes.actions}>
        {links.map((link, i) => (
          <LinkButton
            key={link.url}
            to={offeringHref(link.url)}
            size="small"
            color="primary"
            variant={i === 0 ? 'contained' : 'outlined'}
          >
            {link.title ?? link.url}
          </LinkButton>
        ))}
        <LinkButton to={details} size="small">
          Details
        </LinkButton>
      </CardActions>
    </Card>
  );
};
