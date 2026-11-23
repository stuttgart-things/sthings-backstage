import { useEffect, useMemo, useState } from 'react';
import { identityApiRef, useApi } from '@backstage/core-plugin-api';

/** Greetings that fit any time of day. */
export const REGIONAL_GREETINGS = ['Servus', 'Gude'];

/**
 * German and English greeting for the hour, plus the regional ones.
 * Replaces plugin-home's WelcomeTitle, which picks from about 60 languages.
 */
export function greetingsFor(hour: number): string[] {
  if (hour < 12) {
    return ['Guten Morgen', 'Good morning', ...REGIONAL_GREETINGS];
  }
  if (hour < 17) {
    return ['Guten Tag', 'Good afternoon', ...REGIONAL_GREETINGS];
  }
  return ['Guten Abend', 'Good evening', ...REGIONAL_GREETINGS];
}

export function pickGreeting(hour: number, random: number): string {
  const options = greetingsFor(hour);
  return options[Math.floor(random * options.length) % options.length];
}

/** "Servus, Jane!" -- one greeting per page load, name from the profile. */
export const Greeting = () => {
  const identityApi = useApi(identityApiRef);
  const greeting = useMemo(
    () => pickGreeting(new Date().getHours(), Math.random()),
    [],
  );
  const [name, setName] = useState<string>();
  useEffect(() => {
    let active = true;
    identityApi
      .getProfileInfo()
      .then(profile => active && setName(profile.displayName))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [identityApi]);
  return <>{name ? `${greeting}, ${name}!` : `${greeting}!`}</>;
};
