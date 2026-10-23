// A minimal client for the clash API of sing-box, shared by mode.uc and the
// rpcd plugin of LuCI.
//
// import { clash_api, clash_request, config_modes } from 'hako.clash';

'use strict';

import * as socket from 'socket';

// the clash API of a config, null when it has none
function clash_api(config) {
  const api = config?.experimental?.clash_api;
  if (!api?.external_controller)
    return null;

  const controller = api.external_controller;
  const host = substr(controller, 0, rindex(controller, ':'));

  return {
    host: host,
    port: +substr(controller, rindex(controller, ':') + 1),
    secret: api.secret,
    default_mode: api.default_mode ?? 'Rule'
  };
}

// a minimal HTTP/1.0 request: its status and JSON body, null when nothing
// listens yet
function clash_request(api, method, path, body) {
  let host = replace(api.host, /^\[|\]$/g, '');
  if (host in [ '', '0.0.0.0', '::' ])
    host = '127.0.0.1';

  const sock = socket.connect(host, `${api.port}`, null, 3000);
  if (!sock)
    return null;

  let req = `${method} ${path} HTTP/1.0\r\nHost: ${host}\r\n`;
  if (api.secret)
    req += `Authorization: Bearer ${api.secret}\r\n`;
  if (body != null)
    req += `Content-Type: application/json\r\nContent-Length: ${length(body)}\r\n`;

  sock.send(`${req}\r\n${body ?? ''}`);

  let resp = '', chunk;
  while ((chunk = sock.recv(4096)) != null && length(chunk) > 0)
    resp += chunk;

  sock.close();

  const status = +match(resp, /^HTTP\/1\.\d (\d+)/)?.[1];
  const content = substr(resp, index(resp, '\r\n\r\n') + 4);
  let data = null;

  try {
    data = length(content) ? json(content) : null;
  }
  catch (e) {}

  return { status: status, data: data };
}

// the outbound modes a config offers: its default mode and those of the
// rules, which sing-box matches regardless of case
function config_modes(config, api) {
  const modes = [ api.default_mode ];

  for (let rule in [ ...(config?.route?.rules ?? []), ...(config?.dns?.rules ?? []) ])
    if (type(rule.clash_mode) == 'string' && !length(filter(modes, (m) => lc(m) == lc(rule.clash_mode))))
      push(modes, rule.clash_mode);

  return modes;
}

export { clash_api, clash_request, config_modes };
