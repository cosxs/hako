#!/usr/bin/ucode
// Bring /etc/config/openbox to the current version. Upgrades keep the config,
// so options and sections added to the defaults later have to be added here;
// each step moves the config one version up. The defaults carry the latest
// main.config_version, so a new install runs no step.

'use strict';

import { cursor } from 'uci';

const CONFIG = 'openbox';

// OPENBOX_CONFDIR and OPENBOX_SAVEDIR point the tests at their own config
const uci = cursor(getenv('OPENBOX_CONFDIR'), getenv('OPENBOX_SAVEDIR'));
uci.load(CONFIG);

// MIGRATIONS[i] moves version i + 1 to i + 2. Version 1 is the baseline:
// the device settings in openbox and each profile in a package of its own;
// configs from before it are not migrated
const MIGRATIONS = [
];

const latest = length(MIGRATIONS) + 1;
const current = uci.get(CONFIG, 'main', 'config_version');
let version = +(current ?? '1');

// a config without a version is from the first release
if (uci.get(CONFIG, 'main') && (current == null || version < latest)) {
	for (; version < latest; version++)
		MIGRATIONS[version - 1](uci);

	uci.set(CONFIG, 'main', 'config_version', `${latest}`);
	uci.save(CONFIG);
	uci.commit(CONFIG);
}
