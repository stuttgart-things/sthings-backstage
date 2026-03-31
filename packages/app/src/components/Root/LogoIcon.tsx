import { makeStyles } from '@material-ui/core';
import sthingsLogo from '../../assets/sthings-logo.png';

const useStyles = makeStyles({
  img: {
    height: 36,
    width: 'auto',
  },
});

const LogoIcon = () => {
  const classes = useStyles();

  return <img className={classes.img} src={sthingsLogo} alt="sthings" />;
};

export default LogoIcon;
