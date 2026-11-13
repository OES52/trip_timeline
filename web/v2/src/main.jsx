import { render } from 'preact';
import './styles/tokens.css';
import './styles/fonts.css';
import 'pretendard-jp/dist/web/variable/pretendardvariable-jp-dynamic-subset.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/board.css';
import './styles/timeline.css';
import './styles/screens.css';
import { App } from './app.jsx';
import { load } from './data/store.js';

render(<App />, document.getElementById('app'));
load();
