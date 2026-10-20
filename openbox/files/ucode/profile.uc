// The profiles of OpenBox, beside the settings of the device in openbox
// (takeover, firewall, clash API, plugin settings): each one is a UCI package
// openbox_<name> with what sing-box runs (nodes, groups, rules, DNS and so
// on). A profile may take nodes from subscriptions as well, its subscription
// sections, each downloaded into SUBSCRIPTION_DIR/<name>/<subscription>.json.
// Shared by generate.uc, firewall.uc, migrate.uc and the rpcd plugin of LuCI.
//
// import { DEVICE, SUBSCRIPTION_DIR, valid_name, profile_package, current_profile,
//          profile_source, subscription_file, subscription_prefix,
//          subscription_node } from 'openbox.profile';

'use strict';

const DEVICE = 'openbox';
const PREFIX = 'openbox_';
// OPENBOX_SUBSCRIPTION_DIR points the tests at their own
const SUBSCRIPTION_DIR = getenv('OPENBOX_SUBSCRIPTION_DIR') || '/etc/openbox/subscriptions';

// lowercase letters, digits and "_", as UCI package names take them; also
// safe to pass to the shell unquoted
const NAME = /^[a-z0-9_]{1,32}$/;

function valid_name(name) {
  return type(name) == 'string' && match(name, NAME) != null;
}

// the UCI package of a profile, null for an invalid name
function profile_package(name) {
  return valid_name(name) ? PREFIX + name : null;
}

// the profile to generate: OPENBOX_PROFILE when set, as for viewing a profile
// not in use, else the one in use
function current_profile(uci) {
  return getenv('OPENBOX_PROFILE') || uci.get(DEVICE, 'main', 'profile') || 'default';
}

// where the UCI sections of a profile are: { uci, package } of its own
// package, null when there is none
function profile_source(uci, name) {
  const pkg = profile_package(name);
  return (pkg && uci.load(pkg)) ? { uci: uci, package: pkg } : null;
}

// what a subscription of a profile downloaded; null for an invalid name. A
// subscription is named as a UCI section, which makes it safe in the shell
function subscription_file(name, id) {
  return (valid_name(name) && type(id) == 'string' && match(id, /^[A-Za-z0-9_]{1,64}$/))
    ? `${SUBSCRIPTION_DIR}/${name}/${id}.json` : null;
}

// the nodes of a subscription are named with its prefix, its name when it
// has none, so that those of two subscriptions do not clash
function subscription_prefix(section) {
  const prefix = trim(section?.prefix ?? '');
  return length(prefix) ? prefix : (section?.tag || section?.['.name']);
}

function subscription_node(prefix, tag) {
  return `${prefix} · ${tag}`;
}

export { DEVICE, SUBSCRIPTION_DIR, valid_name, profile_package, current_profile, profile_source, subscription_file,
  subscription_prefix, subscription_node };
