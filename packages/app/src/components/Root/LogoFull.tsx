import { makeStyles } from '@material-ui/core';
import sthingsLogo from '../../assets/sthings-logo.png';

const useStyles = makeStyles({
  img: {
    height: 40,
    width: 'auto',
  },
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 1.2,
    whiteSpace: 'nowrap',
  },
});

const LogoFull = () => {
  const classes = useStyles();

  return (
    <div className={classes.container}>
      <img className={classes.img} src={sthingsLogo} alt="sthings" />
      <span className={classes.text}>sTHINGS</span>
    </div>
  );
};

export default LogoFull;
