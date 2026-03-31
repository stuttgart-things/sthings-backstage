import { makeStyles } from '@material-ui/core';
import sthingsLogo from '../../assets/sthings-logo.png';

const useStyles = makeStyles({
  img: {
    height: 64,
    width: 'auto',
  },
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  text: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: 1.5,
    whiteSpace: 'nowrap',
    lineHeight: 1.2,
  },
  subtitle: {
    color: '#9D8FE8',
    fontSize: 13,
    fontWeight: 400,
    letterSpacing: 0.5,
    whiteSpace: 'nowrap',
  },
});

const LogoFull = () => {
  const classes = useStyles();

  return (
    <div className={classes.container}>
      <img className={classes.img} src={sthingsLogo} alt="sthings" />
      <div>
        <div className={classes.text}>sthings</div>
        <div className={classes.subtitle}>[s&#x2C8;&#x3B8;&#x026A;&#x014B;z]</div>
      </div>
    </div>
  );
};

export default LogoFull;
