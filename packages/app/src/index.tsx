import '@backstage/cli/asset-types';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@backstage/ui/css/styles.css';

// crypto.randomUUID() is only exposed in secure contexts (HTTPS or localhost).
// When the dev app is served over plain HTTP to a hostname (e.g.
// http://dev-vm3...:3000) it is undefined, and @backstage/plugin-signals'
// SignalClient.subscribe throws. Provide a guarded fallback so dev-on-VM works.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  const cryptoObj = (globalThis.crypto ??= {} as Crypto);
  cryptoObj.randomUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const rand = (Math.random() * 16) | 0;
      const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
      return value.toString(16);
    }) as `${string}-${string}-${string}-${string}-${string}`;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
