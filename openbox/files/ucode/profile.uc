// The profiles of OpenBox: each one is a UCI package openbox_<name> with what
// sing-box runs (nodes, groups, rules, DNS and so on), beside the settings of
// the device in openbox (takeover, firewall, clash API, plugin settings).
// Shared by generate.uc, firewall.uc and the rpcd plugin of LuCI.
//
// import { DEVICE, valid_name, profile_package, current_profile } from 'openbox.profile';

'use strict';

const DEVICE = 'openbox';
const PREFIX = 'openbox_';

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

export { DEVICE, PREFIX, valid_name, profile_package, current_profile };
