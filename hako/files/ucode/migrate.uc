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

// what a section of a type that others refer to is named as, with a number
// counting those of its kind
const NAMED_KINDS = {
  outbound: (section) => (section.type in [ 'selector', 'urltest' ]) ? 'group' : 'node',
  dns_server: () => 'dns', http_client: () => 'http_client', rule_set: () => 'rule_set'
};

// renames the references in the options of a package, old name to new: a
// value or an item of a list naming one. A tag is a name of its own, and
// fields written as JSON, as the detour of dial fields, go to sing-box as
// they are and name tags
function rename_refs(uci, pkg, renamed) {
  const rename = (value) => renamed[value] ?? value;

  uci.foreach(pkg, null, (section) => {
    for (let key, value in section) {
      if (substr(key, 0, 1) == '.' || key == 'tag')
        continue;

      if (type(value) == 'array') {
        const changed = map(value, rename);
        if (join('\n', changed) != join('\n', value))
          uci.set(pkg, section['.name'], key, changed);
      }
      else if (rename(value) != value)
        uci.set(pkg, section['.name'], key, rename(value));
    }
  });
}

// 3: the sections others refer to get a name. UCI names an anonymous one by
// its position in the package, so deleting or moving a section before it
// renamed it and broke what referred to it. One without a tag keeps its
// old name as its tag, which sing-box and fields written as JSON know it by
function named_sections(uci) {
  for (let name in profiles()) {
    const pkg = profile_package(name);
    uci.load(pkg);

    const anonymous = [];
    for (let sectionType in keys(NAMED_KINDS))
      uci.foreach(pkg, sectionType, (section) => {
        if (section['.anonymous'])
          push(anonymous, section);
      });

    const renamed = {};
    const count = {};
    for (let section in anonymous) {
      const kind = NAMED_KINDS[section['.type']](section);
      count[kind] = (count[kind] ?? 0) + 1;
      let id = `${kind}_${count[kind]}`;
      while (uci.get(pkg, id) != null)
        id = `${kind}_${++count[kind]}`;

      if (!section.tag)
        uci.set(pkg, section['.name'], 'tag', section['.name']);
      uci.rename(pkg, section['.name'], id);
      renamed[section['.name']] = id;
    }

    if (!length(anonymous))
      continue;

    rename_refs(uci, pkg, renamed);
    uci.save(pkg);
    uci.commit(pkg);

    // the device settings refer to the profile in use
    if (name == (uci.get(CONFIG, 'main', 'profile') || 'default'))
      rename_refs(uci, CONFIG, renamed);
  }
}

// the IP list of mainland China shipped before version 4, and what replaces it
const OLD_CN_LIST = '/usr/share/hako/rule-set/cn-mainland-ip.srs';
const GEOIP_CN = {
  url: 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs',
  update_interval: '24h',
  initial_path: '/usr/share/hako/rule-set/geoip-cn.srs'
};

// 4: the IP list of mainland China is the geoip-cn rule set of
// SagerNet/sing-geoip, remote as sing-box has it: sing-box keeps it up to
// date, and starts with the one shipped, the latest when built. The rule
// sets that read the old list are that one now. The tproxy firewall
// bypasses no rule sets: sing-box matches them, as for tun
function geoip_rule_set(uci) {
  uci.delete(CONFIG, 'firewall', 'bypass_rule_set');

  for (let name in profiles()) {
    const pkg = profile_package(name);
    uci.load(pkg);

    let changed = false;
    uci.foreach(pkg, 'rule_set', (section) => {
      if (section.path != OLD_CN_LIST)
        return;

      uci.set(pkg, section['.name'], 'type', 'remote');
      uci.set(pkg, section['.name'], 'format', 'binary');
      for (let key, value in GEOIP_CN)
        uci.set(pkg, section['.name'], key, value);
      uci.delete(pkg, section['.name'], 'path');
      if (section.tag == 'cn-mainland-ip')
        uci.set(pkg, section['.name'], 'tag', 'geoip-cn');
      changed = true;
    });

    if (changed) {
      uci.save(pkg);
      uci.commit(pkg);
    }
  }
}

// 5: the route rules Hako adds (sniffing, DNS hijacking, private addresses,
// the outbound modes) are shown with the others: they lose hidden
function shown_route_rules(uci) {
  for (let name in profiles()) {
    const pkg = profile_package(name);
    uci.load(pkg);

    let changed = false;
    uci.foreach(pkg, 'route_rule', (section) => {
      if (section.hidden == null)
        return;

      uci.delete(pkg, section['.name'], 'hidden');
      changed = true;
    });

    if (changed) {
      uci.save(pkg);
      uci.commit(pkg);
    }
  }
}

// MIGRATIONS[i] moves version i + 1 to i + 2. Version 1 is the baseline:
// the device settings in hako and each profile in a package of its own;
// configs from before it are not migrated
const MIGRATIONS = [
  subscription_sections,
  named_sections,
  geoip_rule_set,
  shown_route_rules
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
