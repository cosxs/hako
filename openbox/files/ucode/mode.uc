#!/usr/bin/ucode
// Sets the outbound mode chosen in main.mode on the running sing-box through
// its clash API. sing-box keeps the mode it last ran with in its cache file
// and prefers it to the default mode of its config, so OpenBox sets the mode
// after every start, and on a reload that does not restart sing-box.
//
// usage: mode.uc <running config> [tries, half a second apart]

'use strict';

import { readfile } from 'fs';
import { cursor } from 'uci';
import * as socket from 'socket';

function load_json(path) {
	try {
		return json(readfile(path) ?? '');
	}
	catch (e) {
		return null;
	}
}

// the status of a minimal HTTP/1.0 request, null when nothing listens yet
function request(api, method, path, body) {
	const controller = api.external_controller;
	let host = replace(substr(controller, 0, rindex(controller, ':')), /^\[|\]$/g, '');
	if (host in [ '', '0.0.0.0', '::' ])
		host = '127.0.0.1';

	const sock = socket.connect(host, substr(controller, rindex(controller, ':') + 1), null, 3000);
	if (!sock)
		return null;

	let req = `${method} ${path} HTTP/1.0\r\nHost: ${host}\r\n`;
	if (api.secret)
		req += `Authorization: Bearer ${api.secret}\r\n`;
	req += `Content-Type: application/json\r\nContent-Length: ${length(body)}\r\n\r\n${body}`;

	sock.send(req);

	let resp = '', chunk;
	while ((chunk = sock.recv(4096)) != null && length(chunk) > 0)
		resp += chunk;

	sock.close();

	return +match(resp, /^HTTP\/1\.\d (\d+)/)?.[1];
}

const config = load_json(ARGV[0]);
const api = config?.experimental?.clash_api;
const wanted = cursor().get('openbox', 'main', 'mode');

// nothing chosen yet: sing-box keeps its own
if (!api?.external_controller || !wanted)
	exit(0);

// the modes sing-box offers: its default mode and those of the rules, which
// it matches regardless of case
const modes = [ api.default_mode ?? 'Rule' ];
for (let rule in [ ...(config.route?.rules ?? []), ...(config.dns?.rules ?? []) ])
	if (type(rule.clash_mode) == 'string' && !length(filter(modes, (m) => lc(m) == lc(rule.clash_mode))))
		push(modes, rule.clash_mode);

const mode = filter(modes, (m) => lc(m) == lc(wanted))[0];
if (!mode) {
	warn(`openbox: the config offers no outbound mode '${wanted}'\n`);
	exit(0);
}

const tries = +(ARGV[1] ?? 1) || 1;
for (let i = 0; i < tries; i++) {
	if (i > 0)
		sleep(500);

	if (request(api, 'PATCH', '/configs', sprintf('%J', { mode: mode })) == 204)
		exit(0);
}

exit(1);
