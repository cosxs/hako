// The profiles of OpenBox, beside the settings of the device in openbox
// (takeover, firewall, clash API, plugin settings): each one is a UCI package
// openbox_<name> with what sing-box runs (nodes, groups, rules, DNS and so
// on). A profile made from a subscription has its url in profile.url, and
// takes its nodes from what it downloads into SUBSCRIPTION_DIR/<name>.json.
// Shared by generate.uc, firewall.uc and the rpcd plugin of LuCI.
//
// import { DEVICE, SUBSCRIPTION_DIR, valid_name, profile_package, current_profile,
//          profile_source } from 'openbox.profile';

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

export { DEVICE, SUBSCRIPTION_DIR, valid_name, profile_package, current_profile, profile_source };
