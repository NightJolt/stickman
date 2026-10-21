'use strict';
// Which build of the game this is, shown on the title screen and compared between online
// players. ops/deploy.sh rewrites this file in each release with the commit it published; a copy
// run straight from the repo says 'dev'.
window.VERSION = { build: 'dev', sha: '', date: '' };
