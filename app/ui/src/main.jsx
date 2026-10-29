// One bundle for every Precedent Custom UI surface; the module key picks the screen.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { enableTheme, getContext, IN_FORGE } from './api.js';
import { Spinner } from './components/primitives.jsx';
import DecisionCenter from './surfaces/center.jsx';
import Radar from './surfaces/radar.jsx';
import IssuePanel from './surfaces/issue.jsx';
import Byline from './surfaces/byline.jsx';

const SURFACES = {
  'precedent-jira-log': DecisionCenter,
  'precedent-confluence-log': DecisionCenter,
  'precedent-radar': Radar,
  'precedent-issue-context': IssuePanel,
  'precedent-byline': Byline,
};

function App() {
  const [Surface, setSurface] = useState(null);
  useEffect(() => {
    enableTheme();
    getContext()
      .then((c) => setSurface(() => SURFACES[c.moduleKey] || DecisionCenter))
      .catch(() => setSurface(() => DecisionCenter));
  }, []);
  if (!Surface) return <Spinner />;
  return <Surface />;
}

const UIM = 'precedent-create-warning';

if (!IN_FORGE) document.documentElement.dataset.preview = 'true';
// the Create-dialog modification has no screen: it only watches the summary field
getContext()
  .then((c) => (c.moduleKey === UIM ? import('./uim.js').then((m) => m.startCreateHints(c)) : null))
  .catch(() => null)
  .then((uim) => uim === null && createRoot(document.getElementById('root')).render(<App />));
