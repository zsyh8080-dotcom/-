/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DelphiTreasureHunterGame } from './components/DelphiTreasureHunterGame';

export default function App() {
  const autoStart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  return <DelphiTreasureHunterGame autoStart={autoStart} />;
}
