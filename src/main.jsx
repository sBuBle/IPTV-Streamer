import { render } from 'preact';
import { App } from './app.jsx';
// Self-hosted fonts (imported from JS so Vite resolves the packages)
import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import './index.css';

render(<App />, document.getElementById('app'));