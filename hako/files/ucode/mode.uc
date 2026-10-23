#!/usr/bin/ucode
// Sets the outbound mode chosen in main.mode on the running sing-box through
// its clash API. sing-box keeps the mode it last ran with in its cache file
// and prefers it to the default mode of its config, so Hako sets the mode
// after every start, and on a reload that does not restart sing-box.
//
// usage: mode.uc <running config> [tries, half a second apart]

'use strict';

import { readfile } from 'fs';
import { cursor } from 'uci';
import { clash_api, clash_request, config_modes } from 'hako.clash';

function load_json(path) {
  try {
    return json(readfile(path) ?? '');
  }
  catch (e) {
    return null;
  }
}

const config = load_json(ARGV[0]);
const api = clash_api(config);
const wanted = cursor().get('hako', 'main', 'mode');

// nothing chosen yet: sing-box keeps its own
if (!api || !wanted)
  exit(0);

const mode = filter(config_modes(config, api), (m) => lc(m) == lc(wanted))[0];
if (!mode) {
  warn(`hako: the config offers no outbound mode '${wanted}'\n`);
  exit(0);
}

const tries = +(ARGV[1] ?? 1) || 1;
for (let i = 0; i < tries; i++) {
  if (i > 0)
    sleep(500);

  if (clash_request(api, 'PATCH', '/configs', sprintf('%J', { mode: mode }))?.status == 204)
    exit(0);
}

exit(1);
