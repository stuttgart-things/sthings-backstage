import { Entity, RELATION_OWNED_BY, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { useRouteRef } from '@backstage/core-plugin-api';
import { ItemCardHeader, Link, LinkButton } from '@backstage/core-components';
import {
  EntityRefLinks,
  FavoriteEntity,
  getEntityRelations,
} from '@backstage/plugin-catalog-react';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import Box from '@material-ui/core/Box';
import Card from '@material-ui/core/Card';
import CardActionArea from '@material-ui/core/CardActionArea';
import CardActions from '@material-ui/core/CardActions';
import CardContent from '@material-ui/core/CardContent';
import Chip from '@material-ui/core/Chip';
import Typography from '@material-ui/core/Typography';
import { makeStyles, useTheme } from '@material-ui/core/styles';

const useStyles = makeStyles(theme => ({
  card: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  // Make the body fill available space so the CTA stays pinned to the bottom
  // and every card in a row has its action button aligned.
  actionArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  header: {
    backgroundImage: ({ cardBackgroundImage }: any) => cardBackgroundImage,
    color: ({ cardFontColor }: any) => cardFontColor,
  },
  content: {
    flex: 1,
  },
  description: {
    // Prioritise the gist: clamp long descriptions to a few lines.
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    color: theme.palette.text.secondary,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(1.5),
    color: theme.palette.text.secondary,
    fontSize: '0.8rem',
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(1.5),
  },
  actions: {
    padding: theme.spacing(2),
    paddingTop: 0,
  },
  chooseButton: {
    fontWeight: 700,
  },
}));

/**
 * Custom scaffolder template card with a clickable body and a prominent
 * "Choose template" call-to-action. Injected via the
 * `components.TemplateCardComponent` prop of {@link ScaffolderPage}.
 */
export const TemplateCard = (props: { template: Entity }) => {
  const { template } = props;
  const type = (template.spec?.type as string | undefined) ?? 'other';

  const templateRoute = useRouteRef(scaffolderPlugin.routes.selectedTemplate);
  const { namespace, name } = parseEntityRef(stringifyEntityRef(template));
  const href = templateRoute({ namespace, templateName: name });

  const { getPageTheme } = useTheme() as any;
  const themeForType = getPageTheme({ themeId: type });
  const classes = useStyles({
    cardBackgroundImage: themeForType.backgroundImage,
    cardFontColor: themeForType.fontColor,
  });

  const ownedByRelations = getEntityRelations(template, RELATION_OWNED_BY);
  const tags = template.metadata.tags ?? [];
  const title = template.metadata.title ?? template.metadata.name;

  return (
    <Card className={classes.card}>
      <CardActionArea
        className={classes.actionArea}
        component={Link}
        to={href}
        data-testid="template-card-action-area"
      >
        <ItemCardHeader
          title={title}
          subtitle={type}
          classes={{ root: classes.header }}
        />
        <CardContent className={classes.content}>
          {template.metadata.description && (
            <Typography variant="body2" className={classes.description}>
              {template.metadata.description}
            </Typography>
          )}

          {ownedByRelations.length > 0 && (
            <div className={classes.meta}>
              <span>Owner:&nbsp;</span>
              <EntityRefLinks
                entityRefs={ownedByRelations}
                defaultKind="Group"
                onClick={e => e.stopPropagation()}
              />
            </div>
          )}

          {tags.length > 0 && (
            <div className={classes.tags}>
              {tags.map(tag => (
                <Chip key={tag} label={tag} size="small" />
              ))}
            </div>
          )}
        </CardContent>
      </CardActionArea>

      <CardActions className={classes.actions}>
        <Box width="100%" display="flex" justifyContent="space-between" alignItems="center">
          <FavoriteEntity entity={template} style={{ padding: 4 }} />
          <LinkButton
            to={href}
            color="primary"
            variant="contained"
            size="large"
            fullWidth
            className={classes.chooseButton}
            style={{ marginLeft: 8 }}
            data-testid="template-card-choose"
          >
            Choose template
          </LinkButton>
        </Box>
      </CardActions>
    </Card>
  );
};
