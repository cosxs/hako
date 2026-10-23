#!/usr/bin/ucode
// Bring /etc/config/hako to the current version. Upgrades keep the config,
// so options and sections added to the defaults later have to be added here;
// each step moves the config one version up, and may change the profiles as
// well. The defaults carry the latest main.config_version, so a new install
// runs no step.

'use strict';

import { cursor } from 'uci';
import { lsdir, mkdir, readfile, rename, stat } from 'fs';
import { SUBSCRIPTION_DIR, valid_name, profile_package, subscription_prefix, subscription_node } from 'hako.profile';

const CONFIG = 'hako';

// HAKO_CONFDIR and HAKO_SAVEDIR point the tests at their own config
const CONFDIR = getenv('HAKO_CONFDIR') || '/etc/config';
const uci = cursor(getenv('HAKO_CONFDIR'), getenv('HAKO_SAVEDIR'));
uci.load(CONFIG);

// the profiles, by name
function profiles() {
  return filter(map(lsdir(CONFDIR) ?? [], (file) => match(file, /^hako_(.+)$/)?.[1]), valid_name);
}

// the nodes a subscription downloaded, by their tags
function downloaded_nodes(path) {
  let sub = null;
  try {
    sub = json(readfile(path) ?? '');
  }
  catch (e) {}

  const tags = [];
  for (let kind in [ 'outbounds', 'endpoints' ])
    for (let node in sub?.[kind] ?? [])
      if (type(node) == 'object' && type(node.tag) == 'string' && !(node.type in [ 'direct', 'block', 'dns', 'selector', 'urltest' ]))
        push(tags, node.tag);

  return tags;
}

// what the profile names a node of its subscription by: a reference that
// is no outbound of the profile, renamed in the options that name outbounds
function rename_nodes(uci, pkg, renamed) {
  const outbounds = {};
  uci.foreach(pkg, 'outbound', (section) => {
    outbounds[section['.name']] = true;
    outbounds[section.tag || section['.name']] = true;
  });

  const rename = (ref) => (ref != null && !outbounds[ref] && renamed[ref]) ? renamed[ref] : ref;
  const options = { outbound: [ 'outbounds', 'default' ], route_rule: [ 'outbound' ], route: [ 'final' ], dns_server: [ 'detour' ] };

  for (let sectionType, keys in options)
    uci.foreach(pkg, sectionType, (section) => {
      for (let key in keys) {
        const value = section[key];
        if (type(value) == 'array')
          uci.set(pkg, section['.name'], key, map(value, rename));
        else if (value != null && rename(value) != value)
          uci.set(pkg, section['.name'], key, rename(value));
      }
    });
}

// 2: a profile made from a subscription, its url in its profile section,
// becomes a profile with a subscription section, as any profile may have
// several now; what it downloaded moves to the directory of the profile. Its
// nodes are named with the name of the subscription now, and the profile
// names them so
function subscription_sections(uci) {
  const KEYS = [ 'url', 'update_interval', 'user_agent', 'last_update', 'last_error' ];

  for (let name in profiles()) {
    const pkg = profile_package(name);
    uci.load(pkg);
    if (!uci.get(pkg, 'profile', 'url'))
      continue;

    const id = `sub_${name}`;
    uci.set(pkg, id, 'subscription');
    uci.set(pkg, id, 'tag', uci.get(pkg, 'profile', 'title') || name);
    for (let key in KEYS) {
      const value = uci.get(pkg, 'profile', key);
      if (value != null)
        uci.set(pkg, id, key, value);
      uci.delete(pkg, 'profile', key);
    }

    const from = `${SUBSCRIPTION_DIR}/${name}.json`;
    const renamed = {};
    for (let tag in downloaded_nodes(from))
      renamed[tag] = subscription_node(subscription_prefix(uci.get_all(pkg, id)), tag);
    rename_nodes(uci, pkg, renamed);
    uci.save(pkg);
    uci.commit(pkg);

    if (stat(from)) {
      mkdir(`${SUBSCRIPTION_DIR}/${name}`);
      rename(from, `${SUBSCRIPTION_DIR}/${name}/${id}.json`);
    }
  }
}

// MIGRATIONS[i] moves version i + 1 to i + 2. Version 1 is the baseline:
// the device settings in hako and each profile in a package of its own;
// configs from before it are not migrated
const MIGRATIONS = [
  subscription_sections
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
